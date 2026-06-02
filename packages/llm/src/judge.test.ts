import { describe, it, expect } from 'vitest';
import { parseAnswerSignals } from './judge.js';

describe('parseAnswerSignals', () => {
  it('parses a plain JSON object', () => {
    const s = parseAnswerSignals(
      '{"specificity":3,"synthesis_reached":true,"contradiction_open":false,"followup_hint":"担当範囲を掘る"}',
    );
    expect(s.specificity).toBe(3);
    expect(s.synthesisReached).toBe(true);
    expect(s.contradictionOpen).toBe(false);
    expect(s.followupHint).toBe('担当範囲を掘る');
  });

  it('parses a fenced ```json block with preamble', () => {
    const text = 'はい。\n```json\n{"specificity":1,"synthesis_reached":false,"contradiction_open":true,"followup_hint":""}\n```';
    const s = parseAnswerSignals(text);
    expect(s.specificity).toBe(1);
    expect(s.synthesisReached).toBe(false);
    expect(s.contradictionOpen).toBe(true);
    expect(s.followupHint).toBeUndefined(); // 空文字は undefined に正規化
  });

  it('defaults missing fields safely', () => {
    const s = parseAnswerSignals('{}');
    expect(s.specificity).toBe(0);
    expect(s.synthesisReached).toBe(false);
    expect(s.contradictionOpen).toBe(false);
    expect(s.followupHint).toBeUndefined();
  });

  it('throws when no JSON object is present', () => {
    expect(() => parseAnswerSignals('no json here')).toThrow();
  });
});
