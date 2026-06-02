// 面接のフェーズ状態機 (Macro)。spec/inference/dialectic-engine.md §3。
// stage (面接の種類) と直交する「面接内の進行」を純関数で管理する。

export type Phase = 'opening' | 'probe' | 'pressure' | 'closing' | 'ended';

export type AntithesisStrength = 'none' | 'weak' | 'strong';

export type PhaseSpec = {
  intent: string;
  minTurns: number;
  maxTurns: number;
  antithesis: AntithesisStrength;
};

export const PHASE_SPECS: Record<Exclude<Phase, 'ended'>, PhaseSpec> = {
  opening: { intent: '導入。自己紹介を引き出し傾聴する', minTurns: 1, maxTurns: 2, antithesis: 'none' },
  probe: { intent: '主題をファネルで掘る (本体)', minTurns: 4, maxTurns: 10, antithesis: 'weak' },
  pressure: { intent: '矛盾突き・詰めで深掘り耐性を試す', minTurns: 2, maxTurns: 4, antithesis: 'strong' },
  closing: { intent: '合を確認し逆質問を促して締める', minTurns: 1, maxTurns: 2, antithesis: 'none' },
};

export type PhaseState = {
  phase: Phase;
  /** 現 phase で面接官が発話した回数 */
  phaseTurnNo: number;
  /** 全体の残 interviewer turn 予算 */
  turnBudget: number;
  /** ペルソナの圧 1-5 (pressure phase を出すかの判定に使う) */
  personaPressure: number;
};

export type PhaseSignals = {
  /** 主題が十分掘れた (合 synthesis が起きた) */
  synthesisReached: boolean;
  /** 未解決の矛盾が残っている */
  contradictionOpen: boolean;
};

export const DEFAULT_TURN_BUDGET = 20;

/** signals の既定値。判定器 (将来の非同期 judge) が無い間は time-box 駆動になる。 */
export const DEFAULT_SIGNALS: PhaseSignals = {
  synthesisReached: false,
  contradictionOpen: true,
};

export function initialPhaseState(
  personaPressure: number,
  turnBudget: number = DEFAULT_TURN_BUDGET,
): PhaseState {
  return { phase: 'opening', phaseTurnNo: 0, turnBudget, personaPressure };
}

export function pressureEnabled(personaPressure: number): boolean {
  return personaPressure >= 4;
}

/** opening/probe/pressure の次に進む phase を決める。 */
function advance(phase: Phase, personaPressure: number): Phase {
  if (phase === 'opening') return 'probe';
  if (phase === 'probe') return pressureEnabled(personaPressure) ? 'pressure' : 'closing';
  return 'closing'; // pressure → closing
}

function enter(state: PhaseState, phase: Phase): PhaseState {
  return { ...state, phase, phaseTurnNo: 0 };
}

/**
 * 面接官 turn を 1 つ消費した後の次状態を返す純関数。
 * 遷移規則は spec §3.2。signals が無い間は maxTurns/budget による time-box 駆動。
 */
export function nextPhase(state: PhaseState, signals: PhaseSignals = DEFAULT_SIGNALS): PhaseState {
  if (state.phase === 'ended') return state;

  const phaseTurnNo = state.phaseTurnNo + 1;
  const turnBudget = state.turnBudget - 1;
  const s: PhaseState = { ...state, phaseTurnNo, turnBudget };

  if (state.phase === 'closing') {
    const spec = PHASE_SPECS.closing;
    if (phaseTurnNo >= spec.maxTurns || turnBudget <= 0) return { ...s, phase: 'ended' };
    return s;
  }

  // 残予算が closing 必要分まで減ったら強制 closing
  if (turnBudget <= PHASE_SPECS.closing.minTurns) {
    return enter(s, 'closing');
  }

  const spec = PHASE_SPECS[state.phase];

  // maxTurns 到達 → 次 phase
  if (phaseTurnNo >= spec.maxTurns) {
    return enter(s, advance(state.phase, state.personaPressure));
  }

  // probe: minTurns 達成 + 合が起きた → 次 phase
  if (state.phase === 'probe' && phaseTurnNo >= spec.minTurns && signals.synthesisReached) {
    return enter(s, advance('probe', state.personaPressure));
  }

  // pressure: minTurns 達成 + 矛盾が解消 → closing
  if (state.phase === 'pressure' && phaseTurnNo >= spec.minTurns && !signals.contradictionOpen) {
    return enter(s, 'closing');
  }

  return s;
}
