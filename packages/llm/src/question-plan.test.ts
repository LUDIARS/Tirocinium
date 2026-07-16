import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng.js';
import {
  PLAN_SLOT_COUNTS,
  assertPlanCountsWithinSpecs,
  compileQuestionPlan,
  nextSlot,
  type PlanBrief,
  type QuestionCandidate,
} from './question-plan.js';

function candidate(over: Partial<QuestionCandidate> & { theme: string }): QuestionCandidate {
  return {
    question: `${over.theme} について教えてください`,
    followups: [],
    axes: [],
    origin: 'seed',
    ...over,
  };
}

function brief(candidates: QuestionCandidate[]): PlanBrief {
  return { stage: 'hr', role: 'programmer', companyName: 'Example', candidates };
}

const MANY_CANDIDATES: QuestionCandidate[] = [
  candidate({ theme: '企業質問A', origin: 'company', followups: ['なぜ?'] }),
  candidate({ theme: '企業質問B', origin: 'company' }),
  candidate({ theme: 'OB質問A', origin: 'ob', followups: ['具体例は?'] }),
  candidate({ theme: '新卒像A', origin: 'newgrad', followups: ['担当は?'] }),
  candidate({ theme: '一般A', origin: 'seed', axes: ['clarity'] }),
  candidate({ theme: '一般B', origin: 'seed', axes: ['target_fit'], followups: ['他社では?'] }),
  candidate({ theme: '一般C', origin: 'seed' }),
  candidate({ theme: '一般D', origin: 'seed', axes: ['clarity', 'consistency'] }),
  candidate({ theme: '一般E', origin: 'seed' }),
  candidate({ theme: '一般F', origin: 'seed' }),
];

describe('compileQuestionPlan', () => {
  it('同じ seed + 同じブリーフ → 同一プラン (再現性)', () => {
    const a = compileQuestionPlan(brief(MANY_CANDIDATES), ['clarity'], mulberry32(42));
    const b = compileQuestionPlan(brief(MANY_CANDIDATES), ['clarity'], mulberry32(42));
    expect(a).toEqual(b);
  });

  it('phase 割付: opening/closing は定型 1 つずつ、probe/pressure は上限内', () => {
    const plan = compileQuestionPlan(brief(MANY_CANDIDATES), [], mulberry32(1));
    expect(plan.filter((s) => s.phase === 'opening')).toHaveLength(1);
    expect(plan.filter((s) => s.phase === 'closing')).toHaveLength(1);
    expect(plan.filter((s) => s.phase === 'probe').length).toBeLessThanOrEqual(PLAN_SLOT_COUNTS.probe);
    expect(plan.filter((s) => s.phase === 'pressure').length).toBeLessThanOrEqual(PLAN_SLOT_COUNTS.pressure);
    expect(plan[0]!.theme).toBe('自己紹介');
    expect(plan[plan.length - 1]!.theme).toBe('逆質問');
  });

  it('pressure スロットは followups (反の種) を持つ候補のみ', () => {
    const plan = compileQuestionPlan(brief(MANY_CANDIDATES), [], mulberry32(7));
    for (const s of plan.filter((p) => p.phase === 'pressure')) {
      expect(s.followups.length).toBeGreaterThan(0);
    }
  });

  it('供給源優先: company 候補は seed 候補より先に採用される', () => {
    const plan = compileQuestionPlan(brief(MANY_CANDIDATES), [], mulberry32(3));
    const themes = plan.map((s) => s.theme);
    expect(themes).toContain('企業質問A');
    expect(themes).toContain('企業質問B');
  });

  it('弱点駆動: weakTop3 の軸を含む候補が同一供給源内で優先される', () => {
    // followups 無しの seed 8 件 (probe 枠 6) — 弱点軸持ちの 1 件はどの seed でも必ず残る
    const eight: QuestionCandidate[] = [
      ...Array.from({ length: 7 }, (_, i) => candidate({ theme: `平凡${i}` })),
      candidate({ theme: '弱点持ち', axes: ['demeanor'] }),
    ];
    for (const seed of [1, 2, 3, 42, 99]) {
      const plan = compileQuestionPlan(brief(eight), ['demeanor'], mulberry32(seed));
      expect(plan.map((s) => s.theme)).toContain('弱点持ち');
    }
  });

  it('同一 theme は重複しない', () => {
    const dup = [...MANY_CANDIDATES, candidate({ theme: '企業質問A', origin: 'seed' })];
    const plan = compileQuestionPlan(brief(dup), [], mulberry32(9));
    const themes = plan.map((s) => s.theme);
    expect(new Set(themes).size).toBe(themes.length);
  });
});

describe('nextSlot', () => {
  it('phase 内の未消化スロットをカーソル順に返す', () => {
    const plan = compileQuestionPlan(brief(MANY_CANDIDATES), [], mulberry32(11));
    const cursor: Record<string, number> = {};
    const first = nextSlot(plan, 'probe', cursor);
    cursor['probe'] = 1;
    const second = nextSlot(plan, 'probe', cursor);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.theme).not.toBe(second!.theme);
    expect(nextSlot(plan, 'ended', cursor)).toBeNull();
  });

  it('消化し尽くしたら null', () => {
    const plan = compileQuestionPlan(brief(MANY_CANDIDATES), [], mulberry32(13));
    const openings = plan.filter((s) => s.phase === 'opening').length;
    expect(nextSlot(plan, 'opening', { opening: openings })).toBeNull();
  });
});

describe('assertPlanCountsWithinSpecs', () => {
  it('PLAN_SLOT_COUNTS が PHASE_SPECS の maxTurns を超えない', () => {
    expect(() => assertPlanCountsWithinSpecs()).not.toThrow();
  });
});
