// 企業ページのプレーンテキスト → CompanyInput への抽出。
// LLM 抽出 (extractCompany) と、 鍵/失敗時の heuristic fallback (heuristicExtract) の 2 系統。
// LLM 呼び出し以外は純粋関数 (テスト容易性のため parse / heuristic を分離)。

import type Anthropic from '@anthropic-ai/sdk';
import { extractText, extractJsonBlock } from '@tirocinium/llm';
import { extractMetaDescription, extractTitle } from './html.js';
import type { CompanyInput, CrawlSeed } from './types.js';

export const EXTRACT_INSTRUCTION = `
あなたは採用情報ページから「企業の基礎情報」を抽出するアシスタントです。
与えられたページ本文から、就活生が応募先を比較するのに必要な項目だけを JSON で返してください。

出力は **JSON オブジェクト 1 個のみ**。前置き・後置き・コードフェンス以外の説明は禁止。
スキーマ:
{
  "name": "会社名 (必須。不明なら空文字)",
  "industry": "業界 (例: ゲーム / Web / SIer。1 語〜短句)",
  "description": "事業内容の要約 (120 字以内、日本語)",
  "roles": ["募集職種", ...],   // planner/programmer/designer/sound のいずれかに当てはまるものを推定
  "tags": ["技術スタックや社風キーワード", ...],  // 最大 12 個
  "location": "所在地 (都市名程度)",
  "size": "従業員規模 (分かれば。例 '50-200名')"
}

ルール:
- 本文に無い情報は推測で埋めず空文字 / 空配列にする。
- description は誇張せず事実ベースで簡潔に。
- roles は職種名から planner(企画)/programmer(エンジニア)/designer/sound に寄せて推定。
`.trim();

/** LLM の出力テキストを CompanyInput に parse する。 seed で url/nameHint を補完。 */
export function parseCompanyExtraction(text: string, seed?: CrawlSeed): CompanyInput {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    name: s(obj['name']) || seed?.nameHint || '',
    industry: s(obj['industry']),
    description: s(obj['description']),
    roles: arr(obj['roles']),
    tags: arr(obj['tags']),
    location: s(obj['location']),
    size: s(obj['size']),
    url: seed?.url,
    source_url: seed?.url,
  };
}

/** LLM 抽出。 失敗時は呼び出し側が heuristicExtract に fallback する。 */
export async function extractCompany(
  client: Anthropic,
  model: string,
  pageText: string,
  seed?: CrawlSeed,
): Promise<CompanyInput> {
  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system: EXTRACT_INSTRUCTION,
    messages: [{ role: 'user', content: pageText }],
  });
  return parseCompanyExtraction(extractText(res.content), seed);
}

/**
 * 鍵なし / LLM 失敗時の heuristic 抽出。
 * <title> を社名候補、 meta description を概要にして最低限の CompanyInput を作る。
 */
export function heuristicExtract(html: string, seed?: CrawlSeed): CompanyInput {
  const title = extractTitle(html);
  const desc = extractMetaDescription(html);
  // title から「| サービス名」「- 会社概要」 等の suffix を粗く除去
  const name = seed?.nameHint || title.split(/[|｜\-–—･・]/)[0]!.trim() || title;
  return {
    name,
    description: desc,
    url: seed?.url,
    source_url: seed?.url,
  };
}
