// 「関連会社さがし」の検索ページ ⇄ 関連会社ページ間で状態を保持するモジュールレベルキャッシュ。
// ルート遷移 (アンマウント) をまたいでも検索結果・関連会社結果を保持し、 再フェッチせず即描画する。

import type { GameSearchRow, RelatedResult } from '../api/games.js';

export type ResultView = 'card' | 'graph';
export type GameFilters = { smb: boolean; newgrad: boolean; opening: boolean; social: boolean; engine: string };

export const DEFAULT_FILTERS: GameFilters = { smb: false, newgrad: false, opening: false, social: false, engine: '' };

// ── 検索ページの状態 ──────────────────────────────
// lastQ は「直近で検索 API を叩いたクエリ」。 復帰時に q===lastQ なら再フェッチしない。
export const searchState: { q: string; lastQ: string; games: GameSearchRow[] } = { q: '', lastQ: '', games: [] };

// ── 関連会社ページの状態 ───────────────────────────
// 最後に選んだフィルタ / ビューを覚えておき、 別ゲームを開いても踏襲する。
export const relatedState: { filters: GameFilters; view: ResultView } = {
  filters: { ...DEFAULT_FILTERS },
  view: 'card',
};

// gameId × フィルタ ごとの関連会社結果。
const relatedCache = new Map<string, RelatedResult>();

export function relatedKey(gameId: string, f: GameFilters): string {
  return `${gameId}|${f.smb ? 1 : 0}${f.newgrad ? 1 : 0}${f.opening ? 1 : 0}${f.social ? 1 : 0}|${f.engine}`;
}
export function getRelated(key: string): RelatedResult | undefined {
  return relatedCache.get(key);
}
export function setRelated(key: string, r: RelatedResult): void {
  relatedCache.set(key, r);
}

// 選択したゲームの行データ (関連ページのヘッダ即時表示用、 fetch 完了前のフォールバック)。
export const gameMetaCache = new Map<string, GameSearchRow>();
