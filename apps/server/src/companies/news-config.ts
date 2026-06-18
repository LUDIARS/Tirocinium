// 求人ニュースソース設定 (data/companies/news-sources.json) の読み込み + 有効判定。
// listing-config.ts と同じ作法。 rss / job-listing の 2 種をサポートする。

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
  /** rss = ニュースフィード / job-listing = 求人一覧ページ (LLM 抽出) */
  kind: 'rss' | 'job-listing';
  /** フィード / ページの URL 群 */
  urls: string[];
  /** rss のとき採用関連だけに絞るか (既定 true)。 job-listing では無視。 */
  hiringOnly: boolean;
  /** false の source は明示 opt-in (env COMPANY_JOB_NEWS_OPTIN_SOURCES) が無い限り起動しない */
  enabled: boolean;
  note?: string;
};

/** 求人ニュースソース設定を読み込む。 ファイル無し / 不正は空配列。 */
export async function loadNewsSources(): Promise<NewsSourceConfig[]> {
  try {
    const text = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
      .map((r) => ({
        id: String(r['id'] ?? ''),
        kind: (r['kind'] === 'job-listing' ? 'job-listing' : 'rss') as NewsSourceConfig['kind'],
        urls: Array.isArray(r['urls']) ? (r['urls'] as unknown[]).filter((u): u is string => typeof u === 'string') : [],
        hiringOnly: r['hiringOnly'] !== false,
        enabled: r['enabled'] === true,
        note: typeof r['note'] === 'string' ? r['note'] : undefined,
      }))
      .filter((r) => r.id && r.urls.length > 0);
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
