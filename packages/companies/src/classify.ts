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

// 大手判定 (社名)。 該当したら中小ではない。 上場大手ゲーム/IT を主に列挙。
const BIG_COMPANY_PATTERNS = [
  /任天堂/, /\bnintendo\b/i, /ソニー/, /\bsony\b/i, /カプコン/, /\bcapcom\b/i,
  /スクウェア\s*[・･]?\s*エニックス/, /square\s*enix/i, /バンダイ\s*ナムコ/, /bandai\s*namco/i,
  /セガ/, /\bsega\b/i, /コナミ/, /\bkonami\b/i, /コーエー\s*テクモ/, /koei\s*tecmo/i,
  /レベルファイブ/, /level[- ]?5/i, /サイバーエージェント/, /cyber\s*agent/i,
  /サイゲームス/, /cygames/i, /\bdena\b/i, /グリー/, /\bgree\b/i, /ミクシィ/, /\bmixi\b/i,
  /\bgmo\b/i, /楽天/, /\brakuten\b/i,
];

// 規模の手がかりが「大手」を示すパターン (sizeHint 用)。
const BIG_SIZE_PATTERNS = [
  /大手/, /上場/, /プライム市場/, /東証/, /数千名/, /[1-9]\d{3,}\s*名/,
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

/**
 * 中小企業かを判定する (spec/feature/companies/listing-bundle.md §2③ の A 段)。
 * 暫定定義: 非上場 ∧ 大手キーワード非該当 → 中小。 上場/大手が分かれば false、
 * 不明 (非上場 or 上場不明) は inclusive に中小扱い (true)。
 */
export function classifySMB(entry: ListingEntry): boolean {
  if (entry.isListed === true) return false;
  const text = [entry.name, entry.industry, entry.snippet, entry.sizeHint]
    .filter(Boolean)
    .join(' ');
  if (matchAny(BIG_COMPANY_PATTERNS, text)) return false;
  if (matchAny(BIG_SIZE_PATTERNS, entry.sizeHint ?? '')) return false;
  return true;
}

/** listing エントリ (name + snippet + industry + flagsHint) を分類する。 */
export function classifyListingEntry(entry: ListingEntry): CompanyFlags {
  const text = [entry.name, entry.industry, entry.snippet].filter(Boolean).join(' ');
  return { ...classifyFromText(text, entry.flagsHint), isSMB: classifySMB(entry) };
}

/** shouldStock のオプション。 requireSMB=true なら中小以外を除外する。 */
export type StockOptions = { requireSMB?: boolean };

/**
 * ストック判定。
 * - 新卒採用をしている → ストック
 * - 新卒でなくても ゲーム企業 かつ 募集あり → ストック
 * - requireSMB 指定時、 中小でないと明確 (isSMB===false) なら除外する。
 */
export function shouldStock(flags: CompanyFlags, opts: StockOptions = {}): boolean {
  if (opts.requireSMB && flags.isSMB === false) return false;
  return flags.isNewgrad || (flags.isGame && flags.hasOpening);
}

/** ストックした理由を人間可読の短い文字列にする (stock_reason カラム用)。 */
export function stockReason(flags: CompanyFlags): string {
  if (flags.isNewgrad && flags.isGame) return '新卒採用 + ゲーム企業';
  if (flags.isNewgrad) return '新卒採用あり';
  if (flags.isGame && flags.hasOpening) return 'ゲーム企業 + 募集あり';
  return '';
}
