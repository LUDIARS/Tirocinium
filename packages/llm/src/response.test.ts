import { describe, expect, it } from 'vitest';
import {
  buildInterviewerPromptBlock,
  buildSystemPrompt,
  buildWeaknessBlock,
} from './response.js';
import type { InterviewerPersonaInput } from './types.js';

const base: InterviewerPersonaInput = {
  display_name: '田中',
  stage: 'hr',
  role_lens: 'any',
  temperament: 'warm',
  pressure: 2,
  tics: ['なるほど'],
  bio: '人事 10 年',
  evaluation_bias: { demeanor: 1.2 },
};

describe('buildInterviewerPromptBlock', () => {
  it('includes display name, stage label, pressure mapping', () => {
    const out = buildInterviewerPromptBlock(base);
    expect(out).toMatch(/田中/);
    expect(out).toMatch(/人事 \(1次\)/);
    expect(out).toMatch(/2\/5/);
    expect(out).toMatch(/優しめ/);
  });

  it('omits role_lens suffix when "any"', () => {
    const out = buildInterviewerPromptBlock(base);
    expect(out).not.toMatch(/志望者向け/);
  });

  it('includes role_lens suffix when not any', () => {
    const out = buildInterviewerPromptBlock({ ...base, role_lens: 'programmer' });
    expect(out).toMatch(/programmer 志望者向け/);
  });
});

describe('buildWeaknessBlock', () => {
  it('returns empty for empty list', () => {
    expect(buildWeaknessBlock([])).toBe('');
  });

  it('joins axes with comma', () => {
    expect(buildWeaknessBlock(['clarity', 'demeanor'])).toMatch(/clarity, demeanor/);
  });
});

describe('buildSystemPrompt', () => {
  it('always includes static root + interviewer block', () => {
    const p = buildSystemPrompt({ interviewer: base });
    expect(p).toMatch(/LUDIARS Tirocinium/);
    expect(p).toMatch(/田中/);
  });

  it('appends weakness block when weakTop3 has items', () => {
    const p = buildSystemPrompt({ interviewer: base, weakTop3: ['clarity'] });
    expect(p).toMatch(/clarity/);
  });

  it('appends RAG block when provided', () => {
    const p = buildSystemPrompt({ interviewer: base, ragBlock: '本人 ES: ...' });
    expect(p).toMatch(/## 参考素材/);
    expect(p).toMatch(/本人 ES/);
  });

  it('appends refine block when provided', () => {
    const p = buildSystemPrompt({ interviewer: base, refineBlock: '深掘り対象: 一貫性' });
    expect(p).toMatch(/## 次に深掘るべき論点/);
    expect(p).toMatch(/一貫性/);
  });
});
