// 採用ページ / 技術ブログ本文 → 使用技術トークンの LLM 抽出。
// 抽出は LLM (recruit の必須スキル等は非構造のため)、 正準化は決定論 (tech.ts) に委ねる。
// spec/feature/companies/game-graph.md (tech レイヤー)。

import type Anthropic from '@anthropic-ai/sdk';
import { extractText, extractJsonBlock } from '@tirocinium/llm';

export const TECH_INSTRUCTION = `
あなたはゲーム会社の採用ページ・技術ブログから「実際に使われている技術・ツール」を抽出するアシスタントです。
本文に明記された ゲームエンジン / プログラミング言語 / DCC・アートツール / クラウド・インフラ を列挙してください。

出力は **JSON オブジェクト 1 個のみ**。前置き・コードフェンス以外の説明は禁止。
スキーマ: { "tech": ["Unity", "C#", "Unreal Engine", "Maya", "AWS", ...] }

ルール:
- 本文に実在する技術名のみ。 創作しない。 推測で足さない。
- 一般語 (「プログラミング」「デザイン」等) や職種名は技術として列挙しない。
- バージョン表記は残してよい (例 "Unreal Engine 5")。 最大 25 個まで。
`.trim();

/** LLM 出力 → 生技術トークン列 (正準化は tech.ts の parseTechStack で行う)。 */
export function parseTechExtraction(text: string): string[] {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as { tech?: unknown };
  const rows = Array.isArray(obj.tech) ? obj.tech : [];
  return rows.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((s) => s.trim());
}

/** 採用/技術ページ本文から使用技術を抽出する (LLM)。 */
export async function extractTech(client: Anthropic, model: string, pageText: string): Promise<string[]> {
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system: TECH_INSTRUCTION,
    messages: [{ role: 'user', content: pageText }],
  });
  return parseTechExtraction(extractText(res.content));
}
