// 求人ニュース クロール: news-sources の rss / job-listing を取得 → 求人抽出 →
// 新着 (dedup_key 未登録) を DB 投入 → Nuntius 通知。 listing-crawler.ts と同じ礼節 fetch 層。

import { createAnthropicClient, MODEL } from '@tirocinium/llm';
import {
  parseFeed,
  isHiringNews,
  jobPostingFromFeed,
  jobPostingFromListing,
  extractJobListing,
  chunkText,
  htmlToText,
  type JobPostingItem,
} from '@tirocinium/companies';
import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { loadNewsSources, selectActiveNewsSources, type NewsSourceConfig } from './news-config.js';
import { insertNewJobPostings, markNotified } from './job-postings-repo.js';
import { notifyJobPostings } from './job-news-notify.js';

export type JobNewsCrawlSummary = {
  sources: string[];
  fetched: number; // 取得成功したフィード / ページ数
  discovered: number; // 抽出した求人件数 (重複・既存含む)
  inserted: number; // 新規に保存した件数
  notified: number; // Nuntius 通知した件数
  robotsBlocked: number;
  errors: { url: string; message: string }[];
};

/** 求人ニュース クロールを実行する。 sourceId 指定で 1 ソースに絞れる。 */
export async function runJobNewsCrawl(sourceId?: string): Promise<JobNewsCrawlSummary> {
  const summary: JobNewsCrawlSummary = {
    sources: [],
    fetched: 0,
    discovered: 0,
    inserted: 0,
    notified: 0,
    robotsBlocked: 0,
    errors: [],
  };

  const sources = selectActiveNewsSources(await loadNewsSources(), sourceId);
  if (sources.length === 0) return summary;

  const fetcher = new PoliteFetcher({
    userAgent: config.companyCrawl.userAgent,
    fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
    minIntervalMs: config.companyCrawl.minIntervalMs,
    respectRobots: config.companyCrawl.respectRobots,
  });

  // job-listing は LLM 抽出が必須。 利用可能なときだけ client を作る。
  const llmReady = config.llmBackend === 'api' && Boolean(process.env['ANTHROPIC_API_KEY']);
  const client = llmReady ? createAnthropicClient() : null;

  const collected: JobPostingItem[] = [];
  for (const source of sources) {
    summary.sources.push(source.id);
    for (const url of source.urls) {
      try {
        const items = await crawlSourceUrl(source, url, fetcher, client, summary);
        collected.push(...items);
      } catch (err) {
        summary.errors.push({ url, message: (err as Error).message });
      }
    }
  }

  // 同一 run 内の重複キーを畳む (同じ求人が複数チャンク / フィードに出るケース)。
  const deduped = dedupeByKey(collected);
  summary.discovered = deduped.length;

  const inserted = await insertNewJobPostings(deduped);
  summary.inserted = inserted.length;

  // 新着を Nuntius 通知 (宛先未設定なら no-op、 その場合 notified は立てない)。
  if (inserted.length > 0) {
    const res = await notifyJobPostings(inserted);
    if (res.sent) {
      await markNotified(inserted.map((p) => p.id));
      summary.notified = inserted.length;
    }
  }

  console.log(
    `[companies] job-news crawl sources=${summary.sources.join(',')} ` +
      `fetched=${summary.fetched} discovered=${summary.discovered} inserted=${summary.inserted} ` +
      `notified=${summary.notified} robotsBlocked=${summary.robotsBlocked} errors=${summary.errors.length}`,
  );
  return summary;
}

/** 1 URL を取得し、 種別に応じて求人を抽出する。 取得不可は summary に記録して [] を返す。 */
async function crawlSourceUrl(
  source: NewsSourceConfig,
  url: string,
  fetcher: PoliteFetcher,
  client: ReturnType<typeof createAnthropicClient> | null,
  summary: JobNewsCrawlSummary,
): Promise<JobPostingItem[]> {
  const res = await fetcher.fetch(url);
  if (!res.ok) {
    if (res.reason === 'robots') summary.robotsBlocked++;
    else summary.errors.push({ url, message: res.message });
    return [];
  }
  summary.fetched++;
  const cap = config.jobNews.maxItemsPerSource;

  if (source.kind === 'rss') {
    const feed = parseFeed(res.html);
    const out: JobPostingItem[] = [];
    for (const item of feed) {
      if (source.hiringOnly && !isHiringNews(item)) continue;
      const jp = jobPostingFromFeed(source.id, item);
      if (jp) out.push(jp);
      if (out.length >= cap) break;
    }
    return out;
  }

  // job-listing: LLM 抽出 (利用不可なら error 記録)。
  if (!client) {
    summary.errors.push({ url, message: 'job-listing は LLM 抽出が必須 (ANTHROPIC_API_KEY + api backend)' });
    return [];
  }
  const fullText = htmlToText(res.html, config.companyCrawl.listingMaxChars);
  const chunks = chunkText(fullText, config.companyCrawl.listingChunkChars, config.companyCrawl.listingMaxChunks);
  const out: JobPostingItem[] = [];
  for (const chunk of chunks) {
    const entries = await extractJobListing(client, MODEL.EXTRACTOR, chunk);
    for (const entry of entries) {
      const jp = jobPostingFromListing(source.id, url, entry);
      if (jp) out.push(jp);
      if (out.length >= cap) break;
    }
    if (out.length >= cap) break;
  }
  return out;
}

/** dedup_key で重複を畳む (先勝ち)。 */
function dedupeByKey(items: JobPostingItem[]): JobPostingItem[] {
  const seen = new Set<string>();
  const out: JobPostingItem[] = [];
  for (const it of items) {
    if (seen.has(it.dedupKey)) continue;
    seen.add(it.dedupKey);
    out.push(it);
  }
  return out;
}
