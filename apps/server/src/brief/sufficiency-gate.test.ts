import { describe, expect, it } from 'vitest';
import { assessSufficiency } from './sufficiency-gate.js';

describe('assessSufficiency (決定的カウント一次判定)', () => {
  it('企業未解決は常に sparse (一般面接を明示)', () => {
    const r = assessSufficiency({
      companyResolved: false,
      hasNewgradImage: false,
      companyQuestionCount: 0,
      obPatternCount: 0,
    });
    expect(r.level).toBe('sparse');
    expect(r.reason).toContain('一般面接');
  });

  it('新卒像あり + プール 3 件以上で rich', () => {
    const r = assessSufficiency({
      companyResolved: true,
      hasNewgradImage: true,
      companyQuestionCount: 2,
      obPatternCount: 1,
    });
    expect(r.level).toBe('rich');
  });

  it('新卒像のみ / プールのみ は moderate', () => {
    expect(
      assessSufficiency({
        companyResolved: true,
        hasNewgradImage: true,
        companyQuestionCount: 0,
        obPatternCount: 0,
      }).level,
    ).toBe('moderate');
    expect(
      assessSufficiency({
        companyResolved: true,
        hasNewgradImage: false,
        companyQuestionCount: 1,
        obPatternCount: 0,
      }).level,
    ).toBe('moderate');
  });

  it('企業は解決したがデータ皆無なら sparse (無言で企業面接を装わない)', () => {
    const r = assessSufficiency({
      companyResolved: true,
      hasNewgradImage: false,
      companyQuestionCount: 0,
      obPatternCount: 0,
    });
    expect(r.level).toBe('sparse');
    expect(r.reason).toContain('企業固有データ不足');
  });
});
