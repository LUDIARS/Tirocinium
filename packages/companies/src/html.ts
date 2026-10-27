import { replaceDelimited, scanElements, stripRawElements, stripTags } from './markup-scan.js';
import { contract } from './contracts/runtime.js'; /* augur-inject:import:6a8d6959 */
import augurContract_069e2b2d from './contracts/html.contract.js'; /* augur-inject:contract-predicate:ef6ae186 */

// 企業ページ HTML を抽出 LLM に渡す前のプレーンテキスト化。
// 任意サイトが対象のため Lector の専用パーサ (Notion/chat) は使わず、 汎用 strip に徹する。

const BLOCK_TAGS = /<\/(p|div|section|article|li|tr|h[1-6]|header|footer|main|nav)>/gi;

/** title 要素を抜き出す (抽出のヒント / nameHint fallback)。 */
export function extractTitle(html: string): string {
  const element = scanElements(html, /<title/gi, /<\/title>/gi)[0];
  return element ? decodeEntities(element.content).trim() : '';
}

/** meta description を抜き出す。 */
export function extractMetaDescription(html: string): string {
  const m =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html);
  return m ? decodeEntities(m[1]!).trim() : '';
}

/**
 * HTML から可視テキストを抽出する。
 * - script / style / noscript / svg は丸ごと除去
 * - ブロック終了タグを改行に変換して段落感を残す
 * - 連続空白 / 空行を畳む
 * maxChars で末尾を切り、 LLM のトークンを節約する。
 */
export function htmlToText(html: string, maxChars = 8000): string {
  let s = html;
  s = replaceDelimited(s, '<!--', '-->', ' ');
  s = stripRawElements(s);
  s = s.replace(BLOCK_TAGS, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = stripTags(s);
  s = decodeEntities(s);
  s = s.replace(/[ \t　]+/g, ' ');
  s = s.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  s = s.trim();
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}
// @ts-expect-error augur-inject
htmlToText = contract(htmlToText, { ...augurContract_069e2b2d, contractId: 'C-1', mode: 'observe', sample: 1, where: 'packages/companies/src/html.ts:29', rule: 'contract-wrap', id: '069e2b2d' }); /* augur-inject:contract-wrap:069e2b2d */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** 主要な HTML エンティティと数値参照をデコードする。 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}
