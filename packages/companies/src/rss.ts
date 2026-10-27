import { replaceDelimited, scanElements, scanOpeningTags, stripTags } from './markup-scan.js';
// RSS 2.0 / RSS 1.0 (RDF) / Atom フィードを依存ゼロで item 列に parse する。
// 求人ニュースソース (gamebiz / GameBusiness 等) の取得層が使う。
// サイト固有の構造は持たず、 主要 3 方言の <item> / <entry> を緩く拾う純粋関数。

import { decodeEntities } from './html.js';
import { contract } from './contracts/runtime.js'; /* augur-inject:import:1b8d451f */
import augurContract_8cc5e387 from './contracts/feed.contract.js'; /* augur-inject:contract-predicate:8993dd50 */

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
  return decodeEntities(stripTags(replaceDelimited(s, '<![CDATA[', ']]>', null)))
    .replace(/\s+/g, ' ').trim();
}

function tagText(block: string, tag: string): string {
  const opening = new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}(?=\\s|>)`, 'gi');
  const closing = new RegExp(`</(?:[a-zA-Z0-9]+:)?${tag}>`, 'gi');
  const first = scanElements(block, opening, closing)[0];
  return first ? stripMarkup(first.content) : '';
}

function extractLink(block: string): string {
  const hrefs = scanOpeningTags(block, /<link\b/gi).flatMap(opening => {
    const href = /href=["']([^"']+)["']/i.exec(opening)?.[1];
    return href ? [{ opening, href }] : [];
  });
  const selected = hrefs.find(item => /rel=["']alternate["']/i.test(item.opening)) ?? hrefs[0];
  return selected ? decodeEntities(selected.href).trim() : tagText(block, 'link');
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
  const categories = scanElements(block,
    /<(?:[a-zA-Z0-9]+:)?(?:category|subject)(?=\s|>)/gi,
    /<\/(?:[a-zA-Z0-9]+:)?(?:category|subject)>/gi)
    .map(element => stripMarkup(element.content)).filter(Boolean);
  for (const opening of scanOpeningTags(block, /<category\b/gi)) {
    const term = /term=["']([^"']+)["']/i.exec(opening)?.[1];
    if (term) {
      const value = decodeEntities(term).trim();
      if (value) categories.push(value);
    }
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
    ...scanElements(text, /<item\b/gi, /<\/item>/gi),
    ...scanElements(text, /<entry\b/gi, /<\/entry>/gi),
  ];
  const out: FeedItem[] = [];
  for (const m of blocks) {
    const item = parseEntry(m.content);
    if (item.link) out.push(item);
  }
  return out;
}
// @ts-expect-error augur-inject
parseFeed = contract(parseFeed, { ...augurContract_8cc5e387, contractId: 'C-3', mode: 'observe', sample: 1, where: 'packages/companies/src/rss.ts:81', rule: 'contract-wrap', id: '8cc5e387' }); /* augur-inject:contract-wrap:8cc5e387 */
