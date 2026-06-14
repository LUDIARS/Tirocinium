// listing クロール: 設定ソースの一覧ページ → 企業発見 → 分類 → ストック判定 → upsert。
// 新卒採用あり / (ゲーム企業 かつ 募集あり) のみ stock する (spec/companies §3)。

import { createAnthropicClient, MODEL } from '@tirocinium/llm';
import {
  classifyListingEntry,
  shouldStock,
  stockReason,
  normalizeCompany,
  extractListing,
  chunkText,
  htmlToText,
  type ListingSourceConfig,
} from '@tirocinium/companies';
import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { upsertCompany } from './repo.js';
import { loadListingSources, selectActiveSources } from './listing-config.js';

export type ListingCrawlSummary = {
  sources: string[];
  pagesFetched: number;
  discovered: number; // listing から抽出した企業数 (重複含む)
  stocked: number; // ストック条件を満たし upsert した数
  skipped: number; // 条件を満たさず除外
  robotsBlocked: number;
  errors: { url: string; message: string }[];
};

/** listing クロールを実行する。 sourceId 指定で 1 ソースに絞れる。 */
export async function runListingCrawl(sourceId?: string): Promise<ListingCrawlSummary> {
  const summary: ListingCrawlSummary = {
    sources: [],
    pagesFetched: 0,
    discovered: 0,
    stocked: 0,
    skipped: 0,
    robotsBlocked: 0,
    errors: [],
  };

  const sources = selectActiveSources(await loadListingSources(), sourceId);
  if (sources.length === 0) return summary;

  if (config.llmBackend !== 'api' || !process.env['ANTHROPIC_API_KEY']) {
    throw new Error('listing crawl は LLM 抽出が必須です (ANTHROPIC_API_KEY + api backend)');
  }
  const client = createAnthropicClient();
  const fetcher = new PoliteFetcher({
    userAgent: config.companyCrawl.userAgent,
    fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
    minIntervalMs: config.companyCrawl.minIntervalMs,
    respectRobots: config.companyCrawl.respectRobots,
  });

  const maxPages = config.companyCrawl.maxPages;
  let pageCount = 0;

  for (const source of sources) {
    summary.sources.push(source.id);
    for (const url of source.urls) {
      if (pageCount >= maxPages) break;
      pageCount++;
      const res = await fetcher.fetch(url);
      if (!res.ok) {
        if (res.reason === 'robots') summary.robotsBlocked++;
        else summary.errors.push({ url, message: res.message });
        continue;
      }
      summary.pagesFetched++;
      // 巨大一覧 (200社超) は 1 回の抽出で取りこぼすため、 全文をチャンク分割して複数回抽出する (§2①)。
      const fullText = htmlToText(res.html, config.companyCrawl.listingMaxChars);
      const chunks = chunkText(
        fullText,
        source.chunkChars ?? config.companyCrawl.listingChunkChars,
        config.companyCrawl.listingMaxChunks,
      );
      for (const chunk of chunks) {
        try {
          await ingestListingPage(client, source, chunk, summary);
        } catch (err) {
          summary.errors.push({ url, message: (err as Error).message });
        }
      }
    }
  }

  console.log(
    `[companies] listing crawl sources=${summary.sources.join(',')} ` +
      `discovered=${summary.discovered} stocked=${summary.stocked} skipped=${summary.skipped} ` +
      `robotsBlocked=${summary.robotsBlocked} errors=${summary.errors.length}`,
  );
  return summary;
}

/** 1 listing ページ分を抽出 → 分類 → ストック判定 → upsert する。 */
async function ingestListingPage(
  client: ReturnType<typeof createAnthropicClient>,
  source: ListingSourceConfig,
  pageText: string,
  summary: ListingCrawlSummary,
): Promise<void> {
  const entries = await extractListing(client, MODEL.EXTRACTOR, pageText);
  summary.discovered += entries.length;

  for (const entry of entries) {
    const flags = classifyListingEntry(entry);
    if (!shouldStock(flags, { requireSMB: config.companyCrawl.requireSMB })) {
      summary.skipped++;
      continue;
    }
    const normalized = normalizeCompany({
      name: entry.name,
      url: entry.url ?? entry.recruitUrl,
      industry: entry.industry,
      description: entry.snippet,
      source: source.id,
      source_url: entry.recruitUrl ?? entry.url,
    });
    if (!normalized) {
      summary.skipped++;
      continue;
    }
    await upsertCompany(normalized, {
      isNewgrad: flags.isNewgrad,
      isGame: flags.isGame,
      hasOpening: flags.hasOpening,
      isSMB: flags.isSMB ?? false,
      isListed: entry.isListed ?? false,
      recruitUrl: entry.recruitUrl ?? '',
      stockReason: stockReason(flags),
    });
    summary.stocked++;
  }
}
