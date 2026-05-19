import { describe, expect, it } from 'vitest';
import { examineeToSystemPrompt, interviewerToSystemPrompt } from './prompt.js';
import type { ExamineePersona, InterviewerPersona } from './repo.js';

const baseInterviewer: InterviewerPersona = {
  id: 'test-interviewer',
  display_name: 'テスト面接官',
  stage: 'hr',
  role_lens: 'any',
  temperament: 'warm',
  pressure: 3,
  tics: ['「なるほど」', '「もし差し支えなければ」'],
  bio: '人事 10 年',
  evaluation_bias: { demeanor: 1.2 },
  is_seed: true,
  created_at: new Date(),
};

const baseExaminee: ExamineePersona = {
  id: 'test-examinee',
  display_name: 'テスト候補者',
  background: '新卒、 学校で個人開発',
  target_role: 'programmer',
  weakness_axes: { clarity: 3, demeanor: 4 },
  strengths: ['技術話に強い'],
  speech_style: 'nervous',
  intentional_flaws: ['沈黙が多い', '結論先出しが弱い'],
  bio: '面接練習中',
  is_seed: false,
  created_at: new Date(),
};

describe('interviewerToSystemPrompt', () => {
  it('includes display name, stage label, and pressure', () => {
    const p = interviewerToSystemPrompt(baseInterviewer);
    expect(p).toMatch(/テスト面接官/);
    expect(p).toMatch(/人事 \(1次\)/);
    expect(p).toMatch(/3\/5/);
    expect(p).toMatch(/中立/);
  });

  it('embeds tics', () => {
    const p = interviewerToSystemPrompt(baseInterviewer);
    expect(p).toMatch(/「なるほど」/);
  });

  it('omits role_lens line when "any"', () => {
    const p = interviewerToSystemPrompt(baseInterviewer);
    expect(p).not.toMatch(/志望者向け/);
  });

  it('includes role_lens when not "any"', () => {
    const p = interviewerToSystemPrompt({ ...baseInterviewer, role_lens: 'programmer' });
    expect(p).toMatch(/programmer 志望者向け/);
  });
});

describe('examineeToSystemPrompt', () => {
  it('includes speech style label', () => {
    const p = examineeToSystemPrompt(baseExaminee);
    expect(p).toMatch(/緊張で言葉に詰まる/);
  });

  it('lists weakness axes', () => {
    const p = examineeToSystemPrompt(baseExaminee);
    expect(p).toMatch(/clarity: 3/);
    expect(p).toMatch(/demeanor: 4/);
  });

  it('lists intentional flaws as bullet items', () => {
    const p = examineeToSystemPrompt(baseExaminee);
    expect(p).toMatch(/沈黙が多い/);
    expect(p).toMatch(/結論先出しが弱い/);
  });

  it('forbids hallucination', () => {
    const p = examineeToSystemPrompt(baseExaminee);
    expect(p).toMatch(/ハルシネーション禁止/);
  });
});
