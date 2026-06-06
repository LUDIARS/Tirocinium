// 企業のストック判定。 keyword heuristic + LLM ヒントを統合して CompanyFlags を作る。
// ストック条件: 新卒採用あり OR (ゲーム企業 かつ 募集あり)。 純粋関数。

import type { CompanyFlags, ListingEntry } from './types.js';

const NEWGRAD_PATTERNS = [
  /新卒/, /新規\s*学卒/, /新卒採用/, /新卒募集/, /第二新卒/,
  /\d{2}\s*卒/, /20\d{2}\s*年卒/, /20\d{2}\s*年度\s*新卒/,
  /new\s*grad/i, /graduate\s+(hiring|recruit)/i, /fresh\s*graduate/i,
];

const GAME_PATTERNS = [
  /ゲーム/, /げーむ/, /game(s)?/i, /ゲーム開発/, /ゲーム制作/,
  /コンシューマ/, /スマホゲーム/, /モバイルゲーム/, /ソーシャルゲーム/,
  /unity/i, /unreal/i, /cocos/i, /\bue\d\b/i,
  /eスポーツ/, /esports/i, /ゲームエンジン/,
];

const OPENING_PATTERNS = [
  /採用/, /募集/, /求人/, /エントリー/, /中途採用/, /キャリア採用/, /募集中/,
  /we\s*'?re\s*hiring/i, /\bhiring\b/i, /career(s)?/i, /job\s*opening/i, /recruit/i,
];

function matchAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => re.test(text));
}

/**
 * テキスト (listing snippet / ページ本文) から keyword でフラグを推定する。
 * LLM ヒント (hint) があれば true 側を優先採用する (heuristic の取りこぼし補完)。
 */
export function classifyFromText(text: string, hint?: Partial<CompanyFlags>): CompanyFlags {
  const t = text ?? '';
  return {
    isNewgrad: matchAny(NEWGRAD_PATTERNS, t) || hint?.isNewgrad === true,
    isGame: matchAny(GAME_PATTERNS, t) || hint?.isGame === true,
    hasOpening: matchAny(OPENING_PATTERNS, t) || hint?.hasOpening === true,
  };
}

/** listing エントリ (name + snippet + industry + flagsHint) を分類する。 */
export function classifyListingEntry(entry: ListingEntry): CompanyFlags {
  const text = [entry.name, entry.industry, entry.snippet].filter(Boolean).join(' ');
  return classifyFromText(text, entry.flagsHint);
}

/**
 * ストック判定。
 * - 新卒採用をしている → ストック
 * - 新卒でなくても ゲーム企業 かつ 募集あり → ストック
 */
export function shouldStock(flags: CompanyFlags): boolean {
  return flags.isNewgrad || (flags.isGame && flags.hasOpening);
}

/** ストックした理由を人間可読の短い文字列にする (stock_reason カラム用)。 */
export function stockReason(flags: CompanyFlags): string {
  if (flags.isNewgrad && flags.isGame) return '新卒採用 + ゲーム企業';
  if (flags.isNewgrad) return '新卒採用あり';
  if (flags.isGame && flags.hasOpening) return 'ゲーム企業 + 募集あり';
  return '';
}
