// listing ページ (求人サイト / ゲーム業界ソース / 新卒ナビ等) のテキスト → ListingEntry[]。
// LLM 抽出 (extractListing) と parse (純粋) を分離。 サイト固有のセレクタは持たず LLM に委ねる。

import type Anthropic from '@anthropic-ai/sdk';
import { extractText, extractJsonBlock } from '@tirocinium/llm';
import type { ListingEntry } from './types.js';

export const LISTING_INSTRUCTION = `
あなたは採用情報の一覧ページから「掲載されている企業」を抽出するアシスタントです。
ページ本文から企業を列挙し、 各企業について分かる範囲のシグナルを JSON で返してください。

出力は **JSON オブジェクト 1 個のみ**。前置き・コードフェンス以外の説明は禁止。
スキーマ:
{
  "companies": [
    {
      "name": "会社名",
      "recruit_url": "採用/求人ページの URL (本文にあれば。無ければ空文字)",
      "url": "企業サイト URL (あれば)",
      "industry": "業界 (例: ゲーム / Web / SIer)",
      "snippet": "職種や募集の説明 (40字程度)",
      "is_newgrad": true/false,   // 新卒採用と読み取れるか
      "is_game": true/false,      // ゲーム企業と読み取れるか
      "has_opening": true/false   // 募集中と読み取れるか
    }
  ]
}

ルール:
- 本文に実在する企業のみ。 創作しない。 不明な項目は空文字 / false。
- ナビゲーション・広告・関連リンクは企業として列挙しない。
- 1 ページから最大 40 社まで。
`.trim();

/** LLM 出力テキストを ListingEntry[] に parse する。 */
export function parseListing(text: string): ListingEntry[] {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as { companies?: unknown };
  const rows = Array.isArray(obj.companies) ? obj.companies : [];
  const out: ListingEntry[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
    if (!name) continue;
    const s = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    const b = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
    out.push({
      name,
      recruitUrl: s(r['recruit_url']),
      url: s(r['url']),
      industry: s(r['industry']),
      snippet: s(r['snippet']),
      flagsHint: {
        isNewgrad: b(r['is_newgrad']),
        isGame: b(r['is_game']),
        hasOpening: b(r['has_opening']),
      },
    });
  }
  return out;
}

/** listing ページ本文から企業エントリを抽出する (LLM)。 */
export async function extractListing(
  client: Anthropic,
  model: string,
  pageText: string,
): Promise<ListingEntry[]> {
  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    system: LISTING_INSTRUCTION,
    messages: [{ role: 'user', content: pageText }],
  });
  return parseListing(extractText(res.content));
}
