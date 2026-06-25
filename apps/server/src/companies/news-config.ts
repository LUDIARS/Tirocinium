// 求人ニュースソース設定 (data/companies/news-sources.json) の読み込み + 有効判定。
// listing-config.ts と同じ作法。 rss / job-listing / recruit-page の 3 種をサポートする。

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// apps/server/src/companies → ../../../../data/companies/news-sources.json
const CONFIG_PATH = join(
  __dirname, '..', '..', '..', '..', 'data', 'companies', 'news-sources.json',
);

export type NewsSourceConfig = {
  id: string;
  /** rss = ニュースフィード / job-listing = 求人一覧ページ / recruit-page = 企業の自社採用ページ (どちらも LLM 抽出) */
  kind: 'rss' | 'job-listing' | 'recruit-page';
  /** フィード / ページの URL 群 */
  urls: string[];
  /** rss のとき採用関連だけに絞るか (既定 true)。 job-listing / recruit-page では無視。 */
  hiringOnly: boolean;
  /**
   * job-listing / recruit-page で新卒応募可の求人だけに絞るか。
   * 既定は kind 依存: job-listing(aggregator)=true、 recruit-page(明示登録した特定企業)=false (全求人を拾う)。
   * JSON で明示すればその値を優先する。
   */
  newgradOnly: boolean;
  /** recruit-page のとき募集元の社名 (company_id 解決 + 表示に使う固定値)。 他 kind では無視。 */
  company?: string;
  /** false の source は明示 opt-in (env COMPANY_JOB_NEWS_OPTIN_SOURCES) が無い限り起動しない */
  enabled: boolean;
  note?: string;
};

/** news-sources.json の kind 文字列を許可された 3 種に正規化する (不正は 'rss')。 */
function normalizeKind(v: unknown): NewsSourceConfig['kind'] {
  if (v === 'job-listing' || v === 'recruit-page') return v;
  return 'rss';
}

/** JSON.parse 済みの値を NewsSourceConfig[] に正規化する (純粋。 id と urls を持つ要素のみ残す)。 */
export function parseNewsSources(parsed: unknown): NewsSourceConfig[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => {
      const kind = normalizeKind(r['kind']);
      // newgradOnly 既定: recruit-page は false (特定企業の全求人)、 他は true。 明示値があれば優先。
      const newgradOnly = typeof r['newgradOnly'] === 'boolean' ? r['newgradOnly'] : kind !== 'recruit-page';
      return {
        id: String(r['id'] ?? ''),
        kind,
        urls: Array.isArray(r['urls']) ? (r['urls'] as unknown[]).filter((u): u is string => typeof u === 'string') : [],
        hiringOnly: r['hiringOnly'] !== false,
        newgradOnly,
        company: typeof r['company'] === 'string' && r['company'].trim() ? r['company'].trim() : undefined,
        enabled: r['enabled'] === true,
        note: typeof r['note'] === 'string' ? r['note'] : undefined,
      };
    })
    .filter((r) => r.id && r.urls.length > 0);
}

/** 求人ニュースソース設定を読み込む。 ファイル無し / 不正は空配列。 */
export async function loadNewsSources(): Promise<NewsSourceConfig[]> {
  try {
    const text = await readFile(CONFIG_PATH, 'utf8');
    return parseNewsSources(JSON.parse(text) as unknown);
  } catch {
    return [];
  }
}

/**
 * 起動して良いソースを決める。 enabled=true か、 env opt-in に id がある source。
 * sourceId 指定があればその 1 件に絞る。
 */
export function selectActiveNewsSources(
  all: NewsSourceConfig[],
  sourceId?: string,
): NewsSourceConfig[] {
  const optIn = new Set(config.jobNews.optInSources);
  const isActive = (s: NewsSourceConfig): boolean => s.enabled || optIn.has(s.id);
  const pool = sourceId ? all.filter((s) => s.id === sourceId) : all;
  return pool.filter(isActive);
}
