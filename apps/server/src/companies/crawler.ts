// 企業クロールの実行オーケストレータ。
// source.discover → fetch → 抽出 (LLM or heuristic) → 正規化 → upsert。
// 純粋ドメインは @tirocinium/companies、 ここは HTTP / DB / LLM client の配線に徹する。

import {
  createAnthropicClient,
  MODEL,
} from '@tirocinium/llm';
import {
  extractCompany,
  heuristicExtract,
  htmlToText,
  normalizeCompany,
  getSource,
  type CompanyInput,
  type CrawlSeed,
  type CrawlSummary,
} from '@tirocinium/companies';
import { config } from '../config.js';
import { upsertCompany } from './repo.js';
import { safeFetch } from './ssrf-guard.js';

export type RunCrawlInput = {
  source: string;
  urls?: string[];
  seedRecords?: CompanyInput[];
  maxPages?: number;
};

/** タイムアウト付きで HTML を取得する。 */
async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.companyCrawl.fetchTimeoutMs);
  try {
    const res = await safeFetch(url, {
      headers: { 'user-agent': config.companyCrawl.userAgent, accept: 'text/html,*/*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** クロールを実行する。 LLM 鍵が無い / 抽出失敗時は heuristic 抽出に fallback。 */
export async function runCrawl(input: RunCrawlInput): Promise<CrawlSummary> {
  const source = getSource(input.source);
  if (!source) throw new Error(`unknown crawl source: ${input.source}`);

  const maxPages = Math.min(input.maxPages ?? config.companyCrawl.maxPages, config.companyCrawl.maxPages);
  const seeds = (await source.discover({
    fetchText: fetchHtml,
    urls: input.urls,
    seedRecords: input.seedRecords,
    maxPages,
  })).slice(0, maxPages);

  const summary: CrawlSummary = {
    source: input.source,
    discovered: seeds.length,
    fetched: 0,
    extracted: 0,
    upserted: 0,
    skipped: 0,
    errors: [],
  };

  // LLM client は 1 回だけ用意 (鍵が無ければ heuristic のみ)。
  let client: ReturnType<typeof createAnthropicClient> | null = null;
  if (config.llmBackend === 'api') {
    try {
      client = createAnthropicClient();
    } catch {
      client = null;
    }
  }

  // 礼節のため逐次クロール (並列にしない)。
  for (const seed of seeds) {
    try {
      const html = await fetchHtml(seed.url);
      summary.fetched++;
      const extracted = await extractOne(client, html, seed);
      const normalized = normalizeCompany({ ...extracted, source: source.id });
      if (!normalized) {
        summary.skipped++;
        continue;
      }
      summary.extracted++;
      await upsertCompany(normalized);
      summary.upserted++;
    } catch (err) {
      summary.errors.push({ url: seed.url, message: (err as Error).message });
    }
  }

  console.log(
    `[companies] crawl source=${input.source} discovered=${summary.discovered} ` +
      `upserted=${summary.upserted} skipped=${summary.skipped} errors=${summary.errors.length}`,
  );
  return summary;
}

/** 1 ページ分の抽出。 LLM 優先、 失敗時 heuristic。 */
async function extractOne(
  client: ReturnType<typeof createAnthropicClient> | null,
  html: string,
  seed: CrawlSeed,
): Promise<CompanyInput> {
  if (client) {
    try {
      return await extractCompany(client, MODEL.EXTRACTOR, htmlToText(html), seed);
    } catch (err) {
      console.warn(`[companies] LLM extract failed for ${seed.url}, fallback to heuristic:`, (err as Error).message);
    }
  }
  return heuristicExtract(html, seed);
}
