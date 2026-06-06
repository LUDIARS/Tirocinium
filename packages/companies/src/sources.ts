// クロールソース。 discover() で取得対象 seed (URL) を列挙する。
// v1 は外部サイトを無差別に辿らず、 明示 URL / seed ファイル由来の URL のみを対象にする
// (礼節 + 法務リスク回避。 将来 sitemap / 求人サイト API ソースを足す余地を残す)。

import type { CrawlContext, CrawlSeed, CrawlSource } from './types.js';

/** リクエストで渡された URL 群をそのまま seed にする。 */
export const manualSource: CrawlSource = {
  id: 'manual',
  async discover(ctx: CrawlContext): Promise<CrawlSeed[]> {
    return dedupeSeeds((ctx.urls ?? []).map((url) => ({ url })));
  },
};

/** seed ファイル ([{name,url}]) 由来の URL を seed にする。 */
export const seedFileSource: CrawlSource = {
  id: 'seed-file',
  async discover(ctx: CrawlContext): Promise<CrawlSeed[]> {
    const seeds: CrawlSeed[] = [];
    for (const rec of ctx.seedRecords ?? []) {
      if (rec.url) seeds.push({ url: rec.url, nameHint: rec.name });
    }
    return dedupeSeeds(seeds);
  },
};

const SOURCES: Record<string, CrawlSource> = {
  [manualSource.id]: manualSource,
  [seedFileSource.id]: seedFileSource,
};

export function getSource(id: string): CrawlSource | null {
  return SOURCES[id] ?? null;
}

export function listSourceIds(): string[] {
  return Object.keys(SOURCES);
}

/** http(s) のみ許可し、 重複 URL を畳む (SSRF 緩和 + 礼節)。 */
export function dedupeSeeds(seeds: CrawlSeed[]): CrawlSeed[] {
  const map = new Map<string, CrawlSeed>();
  for (const s of seeds) {
    const url = s.url?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (!map.has(url)) map.set(url, { ...s, url });
  }
  return [...map.values()];
}
