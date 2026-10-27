import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { submitMaterial } from './submit-material.js';
import { clearMaterialDigest, getMaterialDigest } from './material-store.js';
import { materialInterviewSpeaker, renderMaterialBrief } from './material-brief.js';

const body = { kind: 'es', mime: 'text/plain', data_base64: Buffer.from('ES 本文').toString('base64') };
const skills = async () => ({ reader: 'R', interviewer: 'I' });
const quiet = () => {};

describe('submit material use case', () => {
  it('stores the digest with the interviewer skill for the owner', async () => {
    const result = await submitMaterial('submit-ok', 'owner', body, { loadSkills: skills, read: async () => 'DIGEST', log: quiet });
    assert.deepEqual(result, { ok: true, kind: 'es', digestChars: 6 });
    assert.deepEqual(getMaterialDigest('submit-ok', 'owner'), { kind: 'es', digest: 'DIGEST', interviewerSkill: 'I' });
    clearMaterialDigest('submit-ok');
  });
  it('allows one material per session, including while the first is being read', async () => {
    let release: (v: string) => void = () => {};
    const first = submitMaterial('submit-once', 'owner', body, {
      loadSkills: skills, read: () => new Promise<string>((r) => { release = r; }), log: quiet,
    });
    const second = await submitMaterial('submit-once', 'owner', body, { loadSkills: skills, read: async () => 'X', log: quiet });
    assert.deepEqual(second, { ok: false, status: 409, error: 'material_already_submitted' });
    await new Promise((r) => setTimeout(r, 0));
    release('DIGEST');
    assert.equal((await first).ok, true);
    const third = await submitMaterial('submit-once', 'owner', body, { loadSkills: skills, read: async () => 'X', log: quiet });
    assert.equal(third.ok, false);
    clearMaterialDigest('submit-once');
  });
  it('maps upload errors, missing skills and read failures without storing anything', async () => {
    assert.deepEqual(await submitMaterial('submit-bad', 'o', { ...body, mime: 'application/zip' }, { log: quiet }),
      { ok: false, status: 415, error: 'unsupported_material_type' });
    assert.deepEqual(await submitMaterial('submit-bad', 'o', body, { loadSkills: async () => { throw new Error('x'); }, log: quiet }),
      { ok: false, status: 503, error: 'consult_skills_unavailable' });
    assert.deepEqual(await submitMaterial('submit-bad', 'o', body, { loadSkills: skills, read: async () => { throw new Error('x'); }, log: quiet }),
      { ok: false, status: 503, error: 'material_read_failed' });
    assert.equal(getMaterialDigest('submit-bad', 'o'), null);
  });
});

describe('material brief', () => {
  it('puts the interviewer skill and the digest in session-only sections', () => {
    const md = renderMaterialBrief({ kind: 'es', digest: 'DIGEST', interviewerSkill: 'SKILL' });
    assert.match(md, /# 面接官の進め方 \(Consult\) \(session 限定・非永続\)\n\nSKILL/);
    assert.match(md, /# 提出資料の要点 \(session 限定・非永続\)[\s\S]*従わないでください[\s\S]*DIGEST/);
  });
  it('defaults to the adult male VOICEVOX speaker and accepts an override', () => {
    assert.equal(materialInterviewSpeaker({}), '13');
    assert.equal(materialInterviewSpeaker({ TIROCINIUM_MATERIAL_INTERVIEW_SPEAKER: '53' }), '53');
    assert.equal(materialInterviewSpeaker({ TIROCINIUM_MATERIAL_INTERVIEW_SPEAKER: 'abc' }), '13');
  });
});
