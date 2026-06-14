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
      "has_opening": true/false,  // 募集中と読み取れるか
      "is_listed": true/false,    // 上場企業と読み取れるか (「上場」「東証」列など。 不明なら省略)
      "size_hint": "規模の手がかり (例: 中小 / 従業員50名 / 大手。 無ければ空文字)"
    }
  ]
}

ルール:
- 本文に実在する企業のみ。 創作しない。 不明な項目は空文字 / false。
- 上場有無が本文から読み取れない場合は is_listed を省略する (false と断定しない)。
- ナビゲーション・広告・関連リンクは企業として列挙しない。
- 1 ページ (チャンク) から最大 40 社まで。
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
      isListed: b(r['is_listed']),
      sizeHint: s(r['size_hint']),
      flagsHint: {
        isNewgrad: b(r['is_newgrad']),
        isGame: b(r['is_game']),
        hasOpening: b(r['has_opening']),
      },
    });
  }
  return out;
}

/**
 * 巨大な一覧テキストを抽出 LLM に渡せるサイズへ分割する (spec/companies/listing-bundle.md §2①)。
 * 改行優先で size 文字ごとに区切り、 maxChunks で打ち切る。 純粋関数。
 */
export function chunkText(text: string, size: number, maxChunks: number): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  if (t.length <= size) return [t];
  const chunks: string[] = [];
  let rest = t;
  while (rest.length > 0 && chunks.length < maxChunks) {
    if (rest.length <= size) {
      chunks.push(rest);
      break;
    }
    // size 付近の改行で割る (無ければ size で強制分割)。
    const slice = rest.slice(0, size);
    const nl = slice.lastIndexOf('\n');
    const cut = nl > size * 0.5 ? nl : size;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return chunks.filter((c) => c.length > 0);
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
