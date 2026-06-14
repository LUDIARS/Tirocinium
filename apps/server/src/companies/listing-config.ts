import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ListingSourceConfig } from '@tirocinium/companies';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// apps/server/src/companies → ../../../../data/companies/listing-sources.json
const CONFIG_PATH = join(
  __dirname, '..', '..', '..', '..', 'data', 'companies', 'listing-sources.json',
);

/** listing ソース設定を読み込む。 ファイル無し / 不正は空配列。 */
export async function loadListingSources(): Promise<ListingSourceConfig[]> {
  try {
    const text = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is ListingSourceConfig => typeof r === 'object' && r !== null)
      .map((r) => ({
        id: String(r.id ?? ''),
        kind: (r.kind ?? 'job-aggregator') as ListingSourceConfig['kind'],
        tier: (r.tier ?? undefined) as ListingSourceConfig['tier'],
        urls: Array.isArray(r.urls) ? r.urls.filter((u): u is string => typeof u === 'string') : [],
        chunkChars: typeof r.chunkChars === 'number' ? r.chunkChars : undefined,
        enabled: r.enabled === true,
        note: typeof r.note === 'string' ? r.note : undefined,
      }))
      .filter((r) => r.id && r.urls.length > 0);
  } catch {
    return [];
  }
}

/**
 * 実際に起動して良いソースを決める。
 * - enabled=true は対象。
 * - enabled=false でも COMPANY_LISTING_OPTIN_SOURCES に id があれば対象 (ToS 厳しめ source の明示 opt-in)。
 * - sourceId 指定があればその 1 件に絞る (opt-in 判定は同様に適用)。
 */
export function selectActiveSources(
  all: ListingSourceConfig[],
  sourceId?: string,
): ListingSourceConfig[] {
  const optIn = new Set(config.companyCrawl.listingOptInSources);
  const isActive = (s: ListingSourceConfig): boolean => s.enabled || optIn.has(s.id);
  const pool = sourceId ? all.filter((s) => s.id === sourceId) : all;
  return pool.filter(isActive);
}
