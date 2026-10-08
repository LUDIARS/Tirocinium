import { describe, expect, it } from 'vitest';
import { fallbackFocusPoints, focusPointsPrompt, parseFocusPoints, renderFocusBlock } from './specialist-focus.js';
import { parseSpecialistProfile } from './specialist-profile.js';
import { buildSystemPrompt } from './response.js';
import { specialistPersona } from './specialist-profile.js';

const senior = parseSpecialistProfile({ role: 'programmer', level: 'entry', interviewer: 'senior' })!;
const field = parseSpecialistProfile({ role: 'designer', level: 'experienced', interviewer: 'field' })!;
const newgrad = { summary: '自走できる新卒', themes: ['自走力', 'チーム開発'] };

describe('specialist focus points', () => {
  it('builds senior and field lists without an LLM, adding newgrad themes to the senior side', () => {
    const points = fallbackFocusPoints(senior, newgrad);
    expect(points.senior.some((p) => p.includes('自走力'))).toBe(true);
    expect(points.field.some((p) => p.includes('プログラマー'))).toBe(true);
    expect(points.senior.length).toBeLessThanOrEqual(6);
    expect(fallbackFocusPoints(field, null).senior.length).toBeGreaterThan(0);
  });

  it('asks the LLM with the ES materials and the newgrad image', () => {
    const prompt = focusPointsPrompt({ profile: senior, newgrad, materials: 'ES: 物理エンジンを自作した' });
    expect(prompt).toContain('物理エンジンを自作した');
    expect(prompt).toContain('自走力');
    expect(prompt).toContain('"senior"');
    expect(focusPointsPrompt({ profile: field, newgrad: null, materials: '' })).toContain('(素材なし)');
  });

  it('parses JSON output and rejects malformed or one-sided lists', () => {
    const text = '前置き {"senior": ["設計の根拠"], "field": ["担当範囲", 3, ""]} 後書き';
    expect(parseFocusPoints(text)).toEqual({ senior: ['設計の根拠'], field: ['担当範囲'] });
    expect(parseFocusPoints('{"senior": [], "field": ["a"]}')).toBeNull();
    expect(parseFocusPoints('not json')).toBeNull();
    expect(parseFocusPoints('{broken')).toBeNull();
    const long = parseFocusPoints(JSON.stringify({ senior: ['x'.repeat(500)], field: Array(10).fill('y') }))!;
    expect(long.senior[0]!.length).toBeLessThanOrEqual(160);
    expect(long.field).toHaveLength(6);
  });

  it('puts the chosen interviewer first and reaches both system prompt paths', () => {
    const points = { senior: ['S1'], field: ['F1'] };
    const block = renderFocusBlock(points, field);
    expect(block.indexOf('F1')).toBeLessThan(block.indexOf('S1'));
    expect(renderFocusBlock(points, senior).indexOf('S1')).toBeLessThan(renderFocusBlock(points, senior).indexOf('F1'));
    for (const briefMd of [undefined, 'brief']) {
      expect(buildSystemPrompt({ interviewer: specialistPersona(field), specialist: field, briefMd, focusBlock: block }))
        .toContain(block);
    }
  });
});
