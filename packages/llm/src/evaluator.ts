import type Anthropic from '@anthropic-ai/sdk';
import { extractText, MODEL } from './anthropic.js';
import { EVAL_INSTRUCTION } from './prompts.js';
import { coerceAxes } from './coerce.js';
import { AXIS_KEYS, type Axes, type Evaluation, type Turn } from './types.js';

export { AXIS_KEYS };

export function serializeHistory(turns: Turn[]): string {
  return turns
    .map((t) => `[${t.turn_no}] (${t.role === 'interviewer' ? '面接官' : '受験者'}): ${t.text}`)
    .join('\n');
}

/** 6 軸を必ず埋め、各値を 0-5 の整数に丸める (欠損は 0)。 */
export function clampAxes(raw: unknown): Axes {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Axes;
  for (const k of AXIS_KEYS) {
    const v = Number(src[k]);
    out[k] = Number.isFinite(v) ? Math.max(0, Math.min(5, Math.round(v))) : 0;
  }
  return out;
}

export type EvaluateInput = {
  turns: Turn[];
  turnRange: [number, number];
};

export type EvaluateOptions = {
  /** self-consistency サンプル数。>1 で複数評価を平均する (既定 1 / env EVAL_SAMPLES) */
  samples?: number;
};

async function evaluateOnce(
  client: Anthropic,
  input: EvaluateInput,
): Promise<{ axes: Axes; comment: string; hints: string[] }> {
  const res = await client.messages.create({
    model: MODEL.EVALUATOR,
    max_tokens: 1024,
    system: EVAL_INSTRUCTION,
    messages: [{ role: 'user', content: serializeHistory(input.turns) }],
  });
  return parseEvaluation(extractText(res.content));
}

export async function evaluate(
  client: Anthropic,
  input: EvaluateInput,
  opts: EvaluateOptions = {},
): Promise<Evaluation> {
  const envN = Number.parseInt(process.env['EVAL_SAMPLES'] ?? '', 10);
  const samples = Math.max(1, opts.samples ?? (Number.isFinite(envN) ? envN : 1));

  const results: { axes: Axes; comment: string; hints: string[] }[] = [];
  for (let i = 0; i < samples; i++) {
    results.push(await evaluateOnce(client, input));
  }

  return {
    turn_range: input.turnRange,
    axes: averageAxes(results.map((r) => r.axes)),
    comment: results.find((r) => r.comment.length > 0)?.comment ?? results[0]!.comment,
    hints: dedupHints(results.flatMap((r) => r.hints)).slice(0, 3),
    model: MODEL.EVALUATOR,
  };
}

/** 複数サンプルの軸を平均して 0-5 整数に丸める。 */
export function averageAxes(samples: Axes[]): Axes {
  if (samples.length === 0) return clampAxes({});
  const out = {} as Axes;
  for (const k of AXIS_KEYS) {
    const mean = samples.reduce((s, a) => s + a[k], 0) / samples.length;
    out[k] = Math.max(0, Math.min(5, Math.round(mean)));
  }
  return out;
}

function dedupHints(hints: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hints) {
    const t = h.trim();
    if (t.length > 0 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Opus が返した text 内の JSON をパースし、軸を clamp・hints を正規化する。 失敗時は throw */
export function parseEvaluation(text: string): {
  axes: Axes;
  comment: string;
  hints: string[];
} {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as { axes?: unknown; comment?: unknown; hints?: unknown };
  const hints = Array.isArray(obj.hints)
    ? obj.hints.filter((h): h is string => typeof h === 'string' && h.trim().length > 0).slice(0, 3)
    : [];
  return {
    // axes 欠損・非 object は coerce が throw (構造違反)。値は 0-5 clamp。
    axes: coerceAxes(obj.axes),
    comment: typeof obj.comment === 'string' ? obj.comment : '',
    hints,
  };
}

/** Opus が ```json で囲んだり前置き付けたりすることを考慮 */
export function extractJsonBlock(text: string): string {
  // ```json ... ``` のブロックを優先
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // 最初の { から最後の } まで
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in LLM output');
  }
  return text.slice(start, end + 1);
}
