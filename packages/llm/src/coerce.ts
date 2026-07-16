// LLM 出力の型検証 (spec/feature/inference/interviewer-reproduction.md §3)。
// 原則: clamp できるものは clamp、構造違反は throw (Pagus json-coerce.ts 流)。
// throw されたら呼び出し側 (Brain) が 1 回だけ再呼び出しし、それでも失敗なら
// engine spec §7 の劣化表に従い既定値へ落とす。

import { AXIS_KEYS, type Axes } from './types.js';
import type { AnswerSignals } from './judge.js';

export class CoerceError extends Error {
  constructor(message: string) {
    super(`[coerce] ${message}`);
    this.name = 'CoerceError';
  }
}

function asObject(raw: unknown, label: string): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CoerceError(`${label}: object でない (${typeof raw})`);
  }
  return raw as Record<string, unknown>;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** judge 出力 → AnswerSignals。非 object は throw、フィールド単位は clamp。 */
export function coerceSignals(raw: unknown): AnswerSignals {
  const obj = asObject(raw, 'signals');
  const hint = typeof obj['followup_hint'] === 'string' ? obj['followup_hint'].trim() : '';
  return {
    specificity: clampInt(obj['specificity'], 0, 3, 0),
    synthesisReached: Boolean(obj['synthesis_reached'] ?? obj['synthesisReached']),
    contradictionOpen: Boolean(obj['contradiction_open'] ?? obj['contradictionOpen']),
    followupHint: hint.length > 0 ? hint : undefined,
  };
}

/** evaluator 出力の axes → 6 軸必須 (欠損 object は throw、値は 0-5 clamp)。 */
export function coerceAxes(raw: unknown): Axes {
  const obj = asObject(raw, 'axes');
  const out = {} as Axes;
  for (const k of AXIS_KEYS) {
    out[k] = clampInt(obj[k], 0, 5, 0);
  }
  return out;
}

/** refine 出力 → 深掘り論点 1 文 (空は null)。string/null 以外は throw。 */
export function coerceFocus(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw new CoerceError(`focus: string でない (${typeof raw})`);
  const t = raw.trim();
  return t.length > 0 ? t : null;
}
