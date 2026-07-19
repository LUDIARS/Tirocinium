// 決定的質問プラン (アルゴリズム面接官の核)。
// spec/feature/inference/interviewer-reproduction.md §4:
// 面接官の戦略を「セッション開始時にコンパイルされる決定的なプラン」にする。
// 純関数 — LLM / DB / env に依存しない。乱択は注入 rng のみ。

import type { Axes } from './types.js';
import { PHASE_SPECS, type Phase } from './phase.js';
import { shuffled, type Rng } from './rng.js';

export type AxisKey = keyof Axes;

// 'refine' はプラン外の逸脱 (refineFocus 採用) の追記マーカー — 逸脱も記録される (spec §4)
export type QuestionOrigin = 'company' | 'ob' | 'newgrad' | 'seed' | 'refine';

export type QuestionSlot = {
  theme: string;            // 例: ガクチカ / 志望動機 / 技術選定の根拠
  question: string;         // 言語化の種 (Brain が persona 口調に整形)
  followups: string[];      // 深掘り候補 (弁証法の「反」の種)
  axes: AxisKey[];          // この質問が測る評価軸
  origin: QuestionOrigin;   // 出所 (監査用)
  phase: Exclude<Phase, 'ended'>; // 割付先フェーズ
};

/** ブリーフが持つ質問候補 (phase 割付前)。origin 付きで供給源を判別する。 */
export type QuestionCandidate = Omit<QuestionSlot, 'phase'>;

/** compileQuestionPlan の入力に必要なブリーフの断面。
 *  md 本文や source_meta は server 側 (brief-builder) が持ち、プランには渡さない。 */
export type PlanBrief = {
  stage: string;
  role: string | null;
  companyName: string | null;
  /** 全供給源から集めた質問候補 (company/ob/newgrad/seed)。 */
  candidates: QuestionCandidate[];
};

const ORIGIN_PRIORITY: Record<QuestionOrigin, number> = {
  company: 0,
  ob: 1,
  newgrad: 2,
  seed: 3,
  refine: 4, // コンパイル時には現れない (実行時逸脱の追記のみ)
};

/** phase ごとの計画スロット数。
 *  nextPhase() (phase.ts) は signals が無い間 (time-box 駆動) 各 phase を
 *  PHASE_SPECS.maxTurns まで消費してから次 phase へ進む。以前は probe=6/pressure=3 と
 *  maxTurns (10/4) を下回っており、maxTurns 近くまで長引いた phase の終盤で候補が尽きて
 *  slot=null (プロンプト駆動へ無言縮退) になり、決定的プランの保証が崩れていた。
 *  各 phase の maxTurns と一致させ、実消費数を必ずカバーする
 *  (合計 18 < DEFAULT_TURN_BUDGET(20) — 逸脱追記 (refineFocus 採用) の余白は残る)。 */
export const PLAN_SLOT_COUNTS: Record<Exclude<Phase, 'ended'>, number> = {
  opening: PHASE_SPECS.opening.maxTurns,
  probe: PHASE_SPECS.probe.maxTurns,
  pressure: PHASE_SPECS.pressure.maxTurns,
  closing: PHASE_SPECS.closing.maxTurns,
};

/** opening / closing は供給源に依らない定型スロット (再現性のため固定文言)。 */
function fixedSlot(phase: 'opening' | 'closing'): QuestionSlot {
  if (phase === 'opening') {
    return {
      theme: '自己紹介',
      question: '最初に、自己紹介と、これまで力を入れてきたことの概要を教えてください。',
      followups: [],
      axes: ['clarity', 'self_understanding'],
      origin: 'seed',
      phase,
    };
  }
  return {
    theme: '逆質問',
    question: '最後に、こちらへ聞いておきたいことはありますか。',
    followups: [],
    axes: ['target_fit'],
    origin: 'seed',
    phase,
  };
}

function weakScore(axes: AxisKey[], weakTop3: AxisKey[]): number {
  return axes.reduce((s, a) => s + (weakTop3.includes(a) ? 1 : 0), 0);
}

/**
 * 質問候補を決定的に選抜し、phase へ割り付ける。
 *
 * コンパイル規則 (spec §4、すべて決定的):
 * 1. 供給源の優先順: company > ob > newgrad > seed。上位が埋まらない分だけ下位で埋める。
 * 2. 弱点駆動: weakTop3 の軸を含む候補を同一供給源内で優先する。
 * 3. phase 割付: PLAN_SLOT_COUNTS に従い opening/probe/pressure/closing に配る。
 *    pressure スロットは followups (反の種) を持つ候補を優先する。
 * 4. 同点候補の順序は注入 rng のシャッフルのみで決める。
 */
export function compileQuestionPlan(
  brief: PlanBrief,
  weakTop3: AxisKey[],
  rng: Rng,
): QuestionSlot[] {
  // 同一 theme の重複は上位 origin を勝たせる (先着 = ソート後の先頭)
  const ranked = shuffled(brief.candidates, rng).sort((a, b) => {
    const p = ORIGIN_PRIORITY[a.origin] - ORIGIN_PRIORITY[b.origin];
    if (p !== 0) return p;
    return weakScore(b.axes, weakTop3) - weakScore(a.axes, weakTop3);
  });
  const dedup: QuestionCandidate[] = [];
  // opening/closing の定型テーマは候補側から除外する (同一テーマの二重質問を防ぐ)
  const seenThemes = new Set<string>(['自己紹介', '逆質問']);
  for (const c of ranked) {
    const key = c.theme.trim();
    if (seenThemes.has(key)) continue;
    seenThemes.add(key);
    dedup.push(c);
  }

  // pressure: followups を持つ候補から優先確保 (弁証法の「反」を仕込むため)
  const pressurePool = dedup.filter((c) => c.followups.length > 0);
  const pressure = pressurePool.slice(0, PLAN_SLOT_COUNTS.pressure);
  const pressureSet = new Set(pressure);

  // probe: 残りから順に
  const probe = dedup.filter((c) => !pressureSet.has(c)).slice(0, PLAN_SLOT_COUNTS.probe);

  return [
    fixedSlot('opening'),
    ...probe.map((c) => ({ ...c, phase: 'probe' as const })),
    ...pressure.map((c) => ({ ...c, phase: 'pressure' as const })),
    fixedSlot('closing'),
  ];
}

/** プランのうち指定 phase の未消化スロットを先頭から返す (runtime のカーソル用)。 */
export function nextSlot(
  plan: QuestionSlot[],
  phase: Phase,
  consumedCount: Record<string, number>,
): QuestionSlot | null {
  if (phase === 'ended') return null;
  const inPhase = plan.filter((s) => s.phase === phase);
  const idx = consumedCount[phase] ?? 0;
  return inPhase[idx] ?? null;
}

// PHASE_SPECS の整合性チェック (プラン数が maxTurns を超えないこと) — ビルド時に気付けるよう関数化
export function assertPlanCountsWithinSpecs(): void {
  for (const [phase, count] of Object.entries(PLAN_SLOT_COUNTS) as [Exclude<Phase, 'ended'>, number][]) {
    if (count > PHASE_SPECS[phase].maxTurns) {
      throw new Error(`PLAN_SLOT_COUNTS.${phase}=${count} が PHASE_SPECS.maxTurns=${PHASE_SPECS[phase].maxTurns} を超えている`);
    }
  }
}
