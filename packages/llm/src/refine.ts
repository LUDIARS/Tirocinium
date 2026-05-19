import type OpenAI from 'openai';
import { OPENAI_MODEL } from './openai.js';
import { serializeHistory } from './evaluator.js';
import type { Turn } from './types.js';

const REFINE_INSTRUCTION = `
あなたは面接設計の補佐です。 過去の面接 turn を読み、 次に面接官 (Sonnet) が
深掘りすべき論点を **1-2 文で** 返してください。

ルール:
- 候補者がまだ語っていない領域、 浅く語った領域、 矛盾していそうな領域 のいずれかを指摘
- Sonnet が即時に質問に変換できる粒度で
- 出力は本文のみ。 「次は〜」 「深掘り対象: 〜」 のような前置きは不要

例:
- 「リーダー経験と短所 (周りが見えない) の整合性を聞き直す」
- 「ジャム賞の等級を正確に確認し、 他者との貢献比率に踏み込む」
- 「『計測してから判断する』 と言ったが、 実装スピードとどう両立するかを問う」
`.trim();

export type RefineInput = {
  turns: Turn[];
};

/** GPT-5.5 (現状 GPT-4o 代替) で「次に深掘るべき論点」 を返す */
export async function refine(
  client: OpenAI,
  input: RefineInput,
): Promise<string> {
  const res = await client.chat.completions.create({
    model: OPENAI_MODEL.REFINE,
    max_tokens: 200,
    temperature: 0.5,
    messages: [
      { role: 'system', content: REFINE_INSTRUCTION },
      { role: 'user', content: serializeHistory(input.turns) },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim() ?? '';
  return text;
}
