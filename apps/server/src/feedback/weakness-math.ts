// 弱点プロファイル EMA の純粋関数群。 DB import を含まないので vitest で
// env なしでもテスト可能。

export const AXES = [
  'consistency',
  'clarity',
  'demeanor',
  'self_understanding',
  'target_fit',
  'depth_resilience',
] as const;
export type Axis = (typeof AXES)[number];

export const ALPHA = 0.3; // EMA 係数 (DESIGN §3.2.2)
const HINT_HISTORY_LIMIT = 50;

export type ProfileSnapshot = {
  axes_ema: Record<string, number>;
  axes_variance: Record<string, number>;
  weak_top3: string[];
  hint_history: string[];
  session_count: number;
};

export function initialSnapshot(): ProfileSnapshot {
  const zeros = Object.fromEntries(AXES.map((a) => [a, 3])) as Record<string, number>;
  const v = Object.fromEntries(AXES.map((a) => [a, 0])) as Record<string, number>;
  return {
    axes_ema: zeros,
    axes_variance: v,
    weak_top3: [],
    hint_history: [],
    session_count: 0,
  };
}

/** EMA で profile を更新 (純粋関数) */
export function applyEvaluationToProfile(
  cur: ProfileSnapshot,
  evalAxes: Partial<Record<string, number>>,
  evalHints: string[],
): ProfileSnapshot {
  const nextAxesEma: Record<string, number> = { ...cur.axes_ema };
  const nextVar: Record<string, number> = { ...cur.axes_variance };

  for (const axis of AXES) {
    const newVal = typeof evalAxes[axis] === 'number' ? evalAxes[axis]! : null;
    if (newVal === null) continue;
    const old = nextAxesEma[axis] ?? 3;
    nextAxesEma[axis] = ALPHA * newVal + (1 - ALPHA) * old;
    const dev = newVal - nextAxesEma[axis]!;
    const oldVar = nextVar[axis] ?? 0;
    nextVar[axis] = ALPHA * dev * dev + (1 - ALPHA) * oldVar;
  }

  const sorted = AXES
    .map((a) => [a, nextAxesEma[a] ?? 3] as const)
    .sort((x, y) => x[1] - y[1])
    .slice(0, 3)
    .map(([a]) => a);

  const nextHints = [...cur.hint_history, ...evalHints].slice(-HINT_HISTORY_LIMIT);

  return {
    axes_ema: nextAxesEma,
    axes_variance: nextVar,
    weak_top3: sorted,
    hint_history: nextHints,
    session_count: cur.session_count + 1,
  };
}
