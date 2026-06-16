// ゲームノードの正規化と、 research の代表作テキスト → 企業→ゲームリンクの決定論パーサ。
// 純粋関数 (LLM 不使用)。 spec/companies/game-graph.md §4。

import type { GameCompanyResearchRecord } from './game-seed.js';
import type { CompanyGameRole, GameInput, GameLink, NormalizedGame } from './types.js';

/** ゲーム名を dedup キーに正規化する (NFKC + lower + 版表記/記号/空白除去)。 */
export function normalizeTitle(title: string): string {
  return (title ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    // 末尾の版・リマスター表記を畳む (同一作の別版を寄せる)。
    .replace(/(リマスター(版)?|リメイク(版)?|hd版|hdリマスター|完全版|決定版|switch版|ps[45]版|steam版)$/g, '')
    .replace(/[【】「」『』（）()[\]、,，.。・:：!！?？\-‐―ー~〜/\\＆&]/g, '')
    .trim();
}

// 主要フランチャイズの別名 → 正規シリーズキー。 表記揺れ・略称・下位シリーズを親へ寄せる。
// 過剰マージを避けるため一般ヒューリスティックでは畳まず、 明示の対応表のみで畳む (キーは normalizeSeries の機械正規化後の形)。
const SERIES_ALIASES: Record<string, string> = {
  // ファイナルファンタジー (FF・下位シリーズ ファブラ ノヴァ クリスタリス を親へ)
  ff: 'ファイナルファンタジー',
  finalfantasy: 'ファイナルファンタジー',
  ファイナルファンタジー: 'ファイナルファンタジー',
  ファブラノヴァクリスタリスff: 'ファイナルファンタジー',
  ファブラノヴァクリスタリス: 'ファイナルファンタジー',
  fabulanovacrystallis: 'ファイナルファンタジー',
  // ドラゴンクエスト
  dq: 'ドラゴンクエスト',
  dragonquest: 'ドラゴンクエスト',
  ドラクエ: 'ドラゴンクエスト',
  ドラゴンクエスト: 'ドラゴンクエスト',
  // ゼルダの伝説
  thelegendofzelda: 'ゼルダの伝説',
  zelda: 'ゼルダの伝説',
  ゼルダの伝説: 'ゼルダの伝説',
  // ペルソナ
  persona: 'ペルソナ',
  ペルソナ: 'ペルソナ',
  // ストリートファイター
  streetfighter: 'ストリートファイター',
  ストリートファイター: 'ストリートファイター',
};

/**
 * シリーズ名を同シリーズ判定キーに正規化する (NFKC + lower + 記号/空白/「シリーズ」除去)。
 * 既知フランチャイズは {@link SERIES_ALIASES} で略称・下位シリーズを親キーへ畳む。
 * 未知シリーズは機械正規化のみ (過剰マージしない)。 空/正規化後空 → ''。 純粋・決定論。
 */
export function normalizeSeries(series: string): string {
  const base = (series ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/(シリーズ|series)$/g, '')
    // 記号は除去するが、 長音符 'ー' は語の一部 (ファイナルファンタジー 等) なので残す。
    .replace(/[【】「」『』（）()[\]、,，.。・:：!！?？\-‐―~〜/\\＆&]/g, '')
    .trim();
  if (!base) return '';
  return SERIES_ALIASES[base] ?? base;
}

/** 括弧 (全角/半角) の深さを考慮して top-level の区切り (、,) で分割する。 */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '（' || ch === '(') depth++;
    else if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === '、' || ch === ',' || ch === '，') && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const SUPPORT_RE = /開発協力|協力|外注|サポート|support|porting|移植/i;

/**
 * research の `games` (代表作テキスト) を「企業→ゲーム」リンク列に分解する。
 * 形式: 「タイトル(詳細、年…)、タイトル(詳細)…」。 括弧内の読点は保護する。
 * role は本文に「開発協力/協力」等があれば support、 無ければ developer (自社開発)。
 */
export function parseGamesFromResearch(research: GameCompanyResearchRecord): GameLink[] {
  const text = (research.games ?? '').trim();
  if (!text) return [];
  const kind = (research.game_kind ?? '').trim();
  const out: GameLink[] = [];
  const seen = new Set<string>();
  for (const entry of splitTopLevel(text)) {
    const m = entry.match(/^([^（(]+)[（(]?([\s\S]*?)[）)]?$/);
    const title = (m ? m[1]! : entry).trim();
    const detail = (m ? m[2]! : '').trim();
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const ym = detail.match(/(19|20)\d{2}/);
    const year = ym ? Number(ym[0]) : 0;
    const role: CompanyGameRole = SUPPORT_RE.test(detail) ? 'support' : 'developer';
    out.push({ title, role, year, kind });
  }
  return out;
}

const MOBILE_RE = /android|\bios\b|iphone|ipad|スマートフォン|モバイル|携帯/i;
const CONSOLE_RE = /switch|playstation|\bps[1-5]\b|プレイステーション|xbox|wii|ニンテンドー|nintendo|3ds|ゲームボーイ|game\s?boy|サターン|ドリームキャスト|アーケード/i;
const PC_RE = /windows|\bpc\b|steam|mac\b|macos|linux|ブラウザ|browser/i;

/**
 * Wikidata P400 等の対応機種ラベル群を mobile/console/pc に分類する。
 * モバイル専用 → 'mobile' (ソシャゲ signal)、 コンシューマ含む → 'console'、 PC のみ → 'pc'。
 */
export function classifyPlatform(labels: string[]): '' | 'mobile' | 'console' | 'pc' {
  const t = labels.join(' ');
  const mobile = MOBILE_RE.test(t);
  const console_ = CONSOLE_RE.test(t);
  const pc = PC_RE.test(t);
  if (mobile && !console_) return 'mobile';
  if (console_) return 'console';
  if (pc) return 'pc';
  return '';
}

function str(v: string | undefined, max: number): string {
  return (v ?? '').trim().slice(0, max);
}

/** 代表作選定の入力 (company_game → games の最小形)。 */
export type RepresentativeGameInput = { title: string; series: string; release_year: number; role: string };

// 自社の作品とみなす role (代表作として優先する)。 support/credited は外部関与なので後回し。
const OWN_GAME_ROLES = new Set<CompanyGameRole>(['developer', 'publisher']);

/** 代表作優先度: 自社開発/発売 を上位 (1)、 関与のみ (support/credited) は 0。 */
function representativeRank(g: RepresentativeGameInput): number {
  return OWN_GAME_ROLES.has(g.role as CompanyGameRole) ? 1 : 0;
}

/**
 * 企業の関与ゲーム群から「代表作」を n 件選ぶ。 純粋・決定論。
 * - シリーズ (正規化) 単位で 1 作に畳む (同一フランチャイズの重複を避ける)。 series 空はタイトル単位。
 * - 各グループ代表は 自社role 優先 → 新しい年 → タイトル昇順 で選ぶ。
 * - 最終並びは 自社role 優先 → release_year 降順 → タイトル昇順。
 */
export function pickRepresentativeGames<T extends RepresentativeGameInput>(games: T[], n: number): T[] {
  if (n <= 0) return [];
  const isBetter = (a: T, b: T): boolean =>
    representativeRank(a) !== representativeRank(b)
      ? representativeRank(a) > representativeRank(b)
      : a.release_year !== b.release_year
        ? a.release_year > b.release_year
        : normalizeTitle(a.title) < normalizeTitle(b.title);

  // シリーズ / タイトルキーごとに代表 1 作を残す。
  const byKey = new Map<string, T>();
  for (const g of games) {
    const skey = normalizeSeries(g.series);
    const tkey = normalizeTitle(g.title);
    const key = skey ? `s:${skey}` : tkey ? `t:${tkey}` : '';
    if (!key) continue; // シリーズもタイトルも正規化後空はスキップ
    const cur = byKey.get(key);
    if (!cur || isBetter(g, cur)) byKey.set(key, g);
  }
  const merged = [...byKey.values()];
  merged.sort(
    (a, b) =>
      representativeRank(b) - representativeRank(a) ||
      b.release_year - a.release_year ||
      a.title.localeCompare(b.title),
  );
  return merged.slice(0, n);
}

/** GameInput を正規化する。 title 空 / 正規化後空 → null (投入対象外)。 */
export function normalizeGame(input: GameInput): NormalizedGame | null {
  const title = str(input.title, 200);
  if (!title) return null;
  const normalized_title = normalizeTitle(title);
  if (!normalized_title) return null;
  const series = str(input.series, 120);
  return {
    title,
    normalized_title,
    series,
    normalized_series: normalizeSeries(series),
    platform: str(input.platform, 60),
    platform_class: str(input.platform_class, 20),
    genre: str(input.genre, 80),
    release_year:
      Number.isFinite(input.release_year) && (input.release_year ?? 0) > 0
        ? Math.round(input.release_year as number)
        : 0,
    source: str(input.source, 60) || 'unknown',
    source_url: str(input.source_url, 500),
  };
}
