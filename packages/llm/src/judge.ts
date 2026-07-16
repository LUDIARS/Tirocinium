// 回答品質ジャッジ (reactive 深掘りの非同期信号源)。
// spec/feature/inference/dialectic-engine.md §4.2: 各 user turn の回答を軽量モデルで評価し、
// phase 状態機の signals (synthesis 到達 / 矛盾の残存) を供給する。
// 面接官応答とは別経路で非同期に走らせるため、知覚レイテンシを増やさない。

import type Anthropic from '@anthropic-ai/sdk';
import { extractText, MODEL } from './anthropic.js';
import { coerceSignals } from './coerce.js';
import { extractJsonBlock, serializeHistory } from './evaluator.js';
import type { Turn } from './types.js';

export type AnswerSignals = {
  /** 0-3 具体性 (0=抽象/一般論, 3=具体例・数値・本人の担当が明確) */
  specificity: number;
  /** 主張が十分掘れ、統合された回答に達したか (合 synthesis) */
  synthesisReached: boolean;
  /** 過去発言・自己評価との未解決の矛盾が残っているか */
  contradictionOpen: boolean;
  /** 次に深掘るべき論点 (1 文)。無ければ undefined */
  followupHint?: string;
};

const JUDGE_INSTRUCTION = `
あなたは面接の進行補佐です。直近の面接官の質問と受験者の回答を読み、回答の質を判定して JSON のみで返してください。

{
  "specificity": <0-3 具体性: 0=抽象的/一般論, 3=具体例・数値・本人の担当が明確>,
  "synthesis_reached": <bool 主張が十分に掘れ、統合された回答に達したか>,
  "contradiction_open": <bool 過去発言や自己評価との未解決の矛盾が残っているか>,
  "followup_hint": "<次に深掘るべき論点を1文。無ければ空文字>"
}

余計な前置きや説明は禁止。JSON のみを出力する。
`.trim();

export function parseAnswerSignals(text: string): AnswerSignals {
  // 構造違反 (非 object) は coerce が throw、フィールド単位は clamp (spec §3)。
  return coerceSignals(JSON.parse(extractJsonBlock(text)));
}

export type AssessInput = {
  /** 面接官が直前に投げた質問 */
  question: string;
  /** 受験者の回答 */
  answer: string;
  /** 直近の文脈 (矛盾検出のため数 turn) */
  recent?: Turn[];
};

/** 軽量モデル (Haiku) で回答を 1 コール評価し、phase 信号を返す。 */
export async function assessAnswer(client: Anthropic, input: AssessInput): Promise<AnswerSignals> {
  const ctx = input.recent && input.recent.length ? serializeHistory(input.recent) + '\n\n' : '';
  const res = await client.messages.create({
    model: MODEL.JUDGE,
    max_tokens: 300,
    system: JUDGE_INSTRUCTION,
    messages: [
      {
        role: 'user',
        content: `${ctx}面接官の質問: ${input.question}\n受験者の回答: ${input.answer}`,
      },
    ],
  });
  return parseAnswerSignals(extractText(res.content));
}
