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

function str(v: string | undefined, max: number): string {
  return (v ?? '').trim().slice(0, max);
}

/** GameInput を正規化する。 title 空 / 正規化後空 → null (投入対象外)。 */
export function normalizeGame(input: GameInput): NormalizedGame | null {
  const title = str(input.title, 200);
  if (!title) return null;
  const normalized_title = normalizeTitle(title);
  if (!normalized_title) return null;
  return {
    title,
    normalized_title,
    series: str(input.series, 120),
    platform: str(input.platform, 60),
    genre: str(input.genre, 80),
    release_year:
      Number.isFinite(input.release_year) && (input.release_year ?? 0) > 0
        ? Math.round(input.release_year as number)
        : 0,
    source: str(input.source, 60) || 'unknown',
    source_url: str(input.source_url, 500),
  };
}
