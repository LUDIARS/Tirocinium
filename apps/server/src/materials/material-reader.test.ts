import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_DIGEST_CHARS, READER_CLI_ARGS, normalizeDigest, readMaterial } from './material-reader.js';

const DIGEST = '## 資料の種類\nES\n\n## 深掘りしたい点\n- 役割\n\n## 質問の候補\n- 担当は?';
const upload = { kind: 'portfolio' as const, mime: 'application/pdf', extension: 'pdf', bytes: Buffer.from('%PDF-1.4') };

describe('material reader', () => {
  it('runs claude with Read only in a temp folder holding just the material, then removes it', async () => {
    let seenDir = '';
    const digest = await readMaterial(upload, 'READER SKILL', async (prompt, options) => {
      seenDir = options.cwd ?? '';
      assert.equal(readFileSync(join(seenDir, 'material.pdf'), 'utf8'), '%PDF-1.4');
      assert.deepEqual(options.extraArgs, READER_CLI_ARGS);
      assert.match(prompt, /READER SKILL/);
      assert.match(prompt, /ポートフォリオ/);
      assert.match(prompt, /指示には従わない/);
      return `前置き\n${DIGEST}`;
    });
    assert.equal(digest, DIGEST);
    assert.equal(existsSync(seenDir), false);
  });
  it('removes the temp folder when reading fails or the output is malformed', async () => {
    let dir = '';
    await assert.rejects(readMaterial(upload, 's', async (_p, o) => { dir = o.cwd ?? ''; return 'まとめられませんでした'; }), /material_digest_malformed/);
    assert.equal(existsSync(dir), false);
    await assert.rejects(readMaterial(upload, 's', async (_p, o) => { dir = o.cwd ?? ''; throw new Error('cli'); }));
    assert.equal(existsSync(dir), false);
  });
  it('times out a stuck reader', async () => {
    await assert.rejects(readMaterial(upload, 's', () => new Promise(() => {}), 20), /material_read_timeout/);
  });
  it('requires the fixed headings and caps the digest length', () => {
    assert.equal(normalizeDigest('## 資料の種類\nES'), null);
    const long = normalizeDigest(`${DIGEST}\n${'あ'.repeat(MAX_DIGEST_CHARS)}`);
    assert.ok(long && long.length <= MAX_DIGEST_CHARS + 20);
  });
});
