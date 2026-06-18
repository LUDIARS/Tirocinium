// RSS 2.0 / RSS 1.0 (RDF) / Atom フィードを依存ゼロで item 列に parse する。
// 求人ニュースソース (gamebiz / GameBusiness 等) の取得層が使う。
// サイト固有の構造は持たず、 主要 3 方言の <item> / <entry> を緩く拾う純粋関数。

import { decodeEntities } from './html.js';

/** フィード 1 件分の正規化済みエントリ。 */
export type FeedItem = {
  title: string;
  link: string;
  /** 本文 / 要約 (プレーンテキスト、 タグ除去済)。 無ければ ''。 */
  description: string;
  /** 公開日時 (ISO8601)。 parse 不能 / 無しは ''。 */
  publishedAt: string;
  /** category / dc:subject などのラベル群。 */
  categories: string[];
};

/** CDATA とタグを落としてプレーンテキスト化する。 */
function stripMarkup(s: string): string {
  return decodeEntities(
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 最初に一致したタグの内側テキストを返す (名前空間 prefix 任意)。 */
function tagText(block: string, tag: string): string {
  const re = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`, 'i');
  const m = re.exec(block);
  return m ? stripMarkup(m[1]!) : '';
}

/** Atom <link href="..."/> もしくは RSS <link>...</link> を拾う。 */
function extractLink(block: string): string {
  // Atom: rel="alternate" を優先、 無ければ最初の href。
  const hrefs = [...block.matchAll(/<link\b[^>]*?href=["']([^"']+)["'][^>]*>/gi)];
  if (hrefs.length > 0) {
    const alt = hrefs.find((m) => /rel=["']alternate["']/i.test(m[0]));
    return decodeEntities((alt ?? hrefs[0]!)[1]!).trim();
  }
  // RSS 2.0 / RDF: <link>URL</link>
  const m = /<(?:[a-zA-Z0-9]+:)?link(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?link>/i.exec(block);
  return m ? stripMarkup(m[1]!) : '';
}

/** 各方言の日時表現を ISO8601 へ。 parse 不能は ''。 */
function parseDate(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

/** 1 つの <item> / <entry> ブロックを FeedItem へ。 */
function parseEntry(block: string): FeedItem {
  const categories = [...block.matchAll(/<(?:[a-zA-Z0-9]+:)?(?:category|subject)(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?(?:category|subject)>/gi)]
    .map((m) => stripMarkup(m[1]!))
    .filter(Boolean);
  // term 属性型 (Atom <category term="..."/>) も拾う。
  for (const m of block.matchAll(/<category\b[^>]*?term=["']([^"']+)["'][^>]*\/?>/gi)) {
    const v = decodeEntities(m[1]!).trim();
    if (v) categories.push(v);
  }
  const publishedAt =
    parseDate(tagText(block, 'pubDate')) ||
    parseDate(tagText(block, 'date')) || // dc:date
    parseDate(tagText(block, 'published')) || // Atom
    parseDate(tagText(block, 'updated')); // Atom fallback
  return {
    title: tagText(block, 'title'),
    link: extractLink(block),
    description: tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content') || tagText(block, 'encoded'),
    publishedAt,
    categories: [...new Set(categories)],
  };
}

/**
 * RSS 2.0 / RSS 1.0(RDF) / Atom のいずれかを parse して item 列を返す。
 * link が空のエントリは捨てる (dedup キーが作れないため)。 純粋関数。
 */
export function parseFeed(xml: string): FeedItem[] {
  const text = xml ?? '';
  const blocks = [
    ...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ];
  const out: FeedItem[] = [];
  for (const m of blocks) {
    const item = parseEntry(m[1]!);
    if (item.link) out.push(item);
  }
  return out;
}
