// 企業サイトの巡回ページ (理念 / IR / 会社概要) のテキスト → CompanyProfileInput。
// LLM 抽出 (extractProfile) と parse (純粋) を分離。

import type Anthropic from '@anthropic-ai/sdk';
import { extractText, extractJsonBlock } from '@tirocinium/llm';
import type { CompanyProfileInput } from './types.js';

export const PROFILE_INSTRUCTION = `
あなたは企業サイトの複数ページ (企業理念 / IR / 会社概要 等) を読み、
就活生が企業研究に使う「企業プロフィール」を要約するアシスタントです。

出力は **JSON オブジェクト 1 個のみ**。前置き・コードフェンス以外の説明は禁止。
スキーマ:
{
  "philosophy": "企業理念 / ミッション (120字以内、無ければ空文字)",
  "values": ["バリュー / 行動指針", ...],   // 無ければ空配列
  "ir_summary": "IR / 業績のハイライト要約 (120字以内、無ければ空文字)",
  "business": "事業内容の要約 (120字以内)"
}

ルール:
- ページ本文に書かれている事実のみ。 推測や誇張をしない。 無い項目は空にする。
- 数値 (売上・従業員数等) は本文にあるものだけ ir_summary に含める。
`.trim();

/** LLM 出力テキストを CompanyProfileInput に parse する。 */
export function parseProfile(text: string): CompanyProfileInput {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as Record<string, unknown>;
  const s = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  return {
    philosophy: s(obj['philosophy']),
    values: arr(obj['values']).slice(0, 12),
    ir_summary: s(obj['ir_summary']),
    business: s(obj['business']),
  };
}

/** 巡回ページ本文 (複数を結合済み) から企業プロフィールを抽出する (LLM)。 */
export async function extractProfile(
  client: Anthropic,
  model: string,
  pagesText: string,
): Promise<CompanyProfileInput> {
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system: PROFILE_INSTRUCTION,
    messages: [{ role: 'user', content: pagesText }],
  });
  return parseProfile(extractText(res.content));
}
