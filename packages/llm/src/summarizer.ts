import type Anthropic from '@anthropic-ai/sdk';
import { extractText, MODEL } from './anthropic.js';
import { extractJsonBlock, serializeHistory } from './evaluator.js';
import { SUMMARY_INSTRUCTION } from './prompts.js';
import type { Evaluation, SummaryDoc, Turn } from './types.js';

export type SummarizeInput = {
  turns: Turn[];
  evaluations: Evaluation[];
};

export async function summarize(
  client: Anthropic,
  input: SummarizeInput,
): Promise<SummaryDoc> {
  const body = [
    '## 全 turn',
    serializeHistory(input.turns),
    '',
    '## 中間評価',
    input.evaluations.map((e, i) => `[評価 ${i + 1}] ${JSON.stringify(e)}`).join('\n'),
  ].join('\n');

  const res = await client.messages.create({
    model: MODEL.SUMMARIZER,
    max_tokens: 2048,
    system: SUMMARY_INSTRUCTION,
    messages: [{ role: 'user', content: body }],
  });
  const text = extractText(res.content);
  return parseSummary(text);
}

export function parseSummary(text: string): SummaryDoc {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as Partial<SummaryDoc>;
  if (
    typeof obj.headline !== 'string' ||
    !Array.isArray(obj.highlights) ||
    !obj.axes_summary ||
    !Array.isArray(obj.growth_points) ||
    !Array.isArray(obj.carry_over) ||
    typeof obj.interviewer_note !== 'string'
  ) {
    throw new Error('summarizer output schema mismatch');
  }
  return obj as SummaryDoc;
}
