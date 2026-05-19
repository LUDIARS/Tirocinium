import type Anthropic from '@anthropic-ai/sdk';
import { extractText, MODEL } from './anthropic.js';
import { EVAL_INSTRUCTION } from './prompts.js';
import type { Evaluation, Turn } from './types.js';

export function serializeHistory(turns: Turn[]): string {
  return turns
    .map((t) => `[${t.turn_no}] (${t.role === 'interviewer' ? '面接官' : '受験者'}): ${t.text}`)
    .join('\n');
}

export type EvaluateInput = {
  turns: Turn[];
  turnRange: [number, number];
};

export async function evaluate(
  client: Anthropic,
  input: EvaluateInput,
): Promise<Evaluation> {
  const res = await client.messages.create({
    model: MODEL.EVALUATOR,
    max_tokens: 1024,
    system: EVAL_INSTRUCTION,
    messages: [{ role: 'user', content: serializeHistory(input.turns) }],
  });
  const text = extractText(res.content);
  const parsed = parseEvaluation(text);
  return {
    turn_range: input.turnRange,
    axes: parsed.axes,
    comment: parsed.comment,
    hints: parsed.hints,
    model: MODEL.EVALUATOR,
  };
}

/** Opus が返した text 内の JSON を厳格にパース。 失敗時は throw */
export function parseEvaluation(text: string): {
  axes: Evaluation['axes'];
  comment: string;
  hints: string[];
} {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as {
    axes?: Evaluation['axes'];
    comment?: string;
    hints?: string[];
  };
  if (!obj.axes || typeof obj.comment !== 'string' || !Array.isArray(obj.hints)) {
    throw new Error('evaluator output schema mismatch');
  }
  return { axes: obj.axes, comment: obj.comment, hints: obj.hints };
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
