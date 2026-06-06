// 企業サイト HTML から enrichment 対象リンク (IR / 理念 / 会社概要 / 採用) を選ぶ。 純粋関数。
// アンカーの可視テキストと href 語彙でカテゴリ分けし、 相対 URL は base で絶対化する。

import { decodeEntities } from './html.js';
import type { EnrichmentLinks } from './types.js';

type Anchor = { href: string; text: string };

const ANCHOR_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/** HTML から <a href> を抽出 (テキストはタグ除去)。 */
export function extractAnchors(html: string): Anchor[] {
  const out: Anchor[] = [];
  let m: RegExpExecArray | null;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    const href = m[1]!.trim();
    const text = decodeEntities(m[2]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (href) out.push({ href, text });
  }
  return out;
}

const VOCAB: Record<keyof EnrichmentLinks, { text: RegExp; href: RegExp }> = {
  ir: {
    text: /\bir\b|投資家|株主|決算|有価証券|財務|investor/i,
    href: /\/ir|investor|finance|shareholder/i,
  },
  philosophy: {
    text: /理念|ミッション|ビジョン|バリュー|私たちの想い|経営理念|行動指針|mission|vision|values|philosophy|purpose/i,
    href: /philosophy|mission|vision|values|purpose|principle/i,
  },
  about: {
    text: /会社概要|企業情報|会社案内|私たちについて|about|company|corporate|会社情報/i,
    href: /about|company|corporate|profile|overview/i,
  },
  recruit: {
    text: /採用|募集|求人|新卒|キャリア|recruit|career|join|hiring/i,
    href: /recruit|career|job|hiring|saiyo|entry/i,
  },
};

/** href を base で絶対化。 失敗時は null。 http(s) のみ。 */
function absolutize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/**
 * 企業サイト HTML から enrichment 対象リンクをカテゴリ別に選ぶ。
 * - 同一ホストのリンクのみ (外部誘導を辿らない)。
 * - 各カテゴリ最大 maxPerCategory 件。 重複 URL は排除。
 */
export function selectEnrichmentLinks(
  baseUrl: string,
  html: string,
  maxPerCategory = 2,
): EnrichmentLinks {
  const anchors = extractAnchors(html);
  const out: EnrichmentLinks = { ir: [], philosophy: [], about: [], recruit: [] };
  const seen: Record<keyof EnrichmentLinks, Set<string>> = {
    ir: new Set(), philosophy: new Set(), about: new Set(), recruit: new Set(),
  };

  for (const a of anchors) {
    const abs = absolutize(a.href, baseUrl);
    if (!abs || !sameHost(abs, baseUrl)) continue;
    for (const key of Object.keys(VOCAB) as (keyof EnrichmentLinks)[]) {
      if (out[key].length >= maxPerCategory) continue;
      const v = VOCAB[key];
      if ((a.text && v.text.test(a.text)) || v.href.test(abs)) {
        if (!seen[key].has(abs)) {
          seen[key].add(abs);
          out[key].push(abs);
        }
      }
    }
  }
  return out;
}

/** enrichment で実際に fetch するページ URL を優先順 (理念 > IR > about > recruit) で平坦化。 */
export function enrichmentFetchList(links: EnrichmentLinks, max = 5): string[] {
  const ordered = [...links.philosophy, ...links.ir, ...links.about, ...links.recruit];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of ordered) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
