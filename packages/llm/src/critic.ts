import type Anthropic from '@anthropic-ai/sdk';
import { extractText, MODEL } from './anthropic.js';
import { extractJsonBlock, serializeHistory } from './evaluator.js';
import { CRITIC_INSTRUCTION } from './prompts.js';
import type { CritiqueDoc, Turn } from './types.js';

export type CritiqueInput = {
  turns: Turn[];
  focusTurnNos: number[];
};

export async function critique(
  client: Anthropic,
  input: CritiqueInput,
): Promise<CritiqueDoc> {
  const focus = input.focusTurnNos.join(', ');
  const body = [
    '## 全 turn',
    serializeHistory(input.turns),
    '',
    `## 改善案を出してほしい turn: ${focus}`,
    '受験者 (turn role = user) の回答に対して、 より良い答え方を提案してください。',
  ].join('\n');

  const res = await client.messages.create({
    model: MODEL.CRITIC,
    max_tokens: 2048,
    system: CRITIC_INSTRUCTION,
    messages: [{ role: 'user', content: body }],
  });
  const text = extractText(res.content);
  return parseCritique(text);
}

export function parseCritique(text: string): CritiqueDoc {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as Partial<CritiqueDoc>;
  if (!Array.isArray(obj.per_turn)) {
    throw new Error('critic output schema mismatch');
  }
  return obj as CritiqueDoc;
}
