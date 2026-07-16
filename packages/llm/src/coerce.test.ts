import { describe, expect, it } from 'vitest';
import { CoerceError, coerceAxes, coerceFocus, coerceSignals } from './coerce.js';

describe('coerceSignals', () => {
  it('正常系: snake_case を camel に写し hint を trim する', () => {
    const s = coerceSignals({
      specificity: 2,
      synthesis_reached: true,
      contradiction_open: false,
      followup_hint: '  担当範囲を聞く  ',
    });
    expect(s).toEqual({
      specificity: 2,
      synthesisReached: true,
      contradictionOpen: false,
      followupHint: '担当範囲を聞く',
    });
  });

  it('clamp: specificity は 0-3 に丸め、空 hint は undefined', () => {
    const s = coerceSignals({ specificity: 99, followup_hint: '' });
    expect(s.specificity).toBe(3);
    expect(s.followupHint).toBeUndefined();
    expect(coerceSignals({ specificity: -5 }).specificity).toBe(0);
    expect(coerceSignals({ specificity: 'x' }).specificity).toBe(0);
  });

  it('構造違反 (非 object) は throw', () => {
    expect(() => coerceSignals(null)).toThrow(CoerceError);
    expect(() => coerceSignals('text')).toThrow(CoerceError);
    expect(() => coerceSignals([1, 2])).toThrow(CoerceError);
  });
});

describe('coerceAxes', () => {
  it('6 軸を必ず埋め 0-5 に clamp、欠損キーは 0', () => {
    const axes = coerceAxes({ consistency: 9, clarity: -1, demeanor: 3.6 });
    expect(axes).toEqual({
      consistency: 5,
      clarity: 0,
      demeanor: 4,
      self_understanding: 0,
      target_fit: 0,
      depth_resilience: 0,
    });
  });

  it('axes 自体の欠損 (null / 非 object) は throw', () => {
    expect(() => coerceAxes(null)).toThrow(CoerceError);
    expect(() => coerceAxes(undefined)).toThrow(CoerceError);
    expect(() => coerceAxes('3')).toThrow(CoerceError);
  });
});

describe('coerceFocus', () => {
  it('string は trim、空は null、null/undefined は null', () => {
    expect(coerceFocus(' 論点 ')).toBe('論点');
    expect(coerceFocus('')).toBeNull();
    expect(coerceFocus('   ')).toBeNull();
    expect(coerceFocus(null)).toBeNull();
    expect(coerceFocus(undefined)).toBeNull();
  });

  it('string/null 以外は throw', () => {
    expect(() => coerceFocus(42)).toThrow(CoerceError);
    expect(() => coerceFocus({})).toThrow(CoerceError);
  });
});
