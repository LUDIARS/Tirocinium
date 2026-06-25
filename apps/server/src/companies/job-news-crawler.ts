// 求人ニュース クロール: news-sources の rss / job-listing を取得 → 求人抽出 →
// 新着 (dedup_key 未登録) を DB 投入 → Nuntius 通知。 listing-crawler.ts と同じ礼節 fetch 層。

import {
  parseFeed,
  isHiringNews,
  jobPostingFromFeed,
  jobPostingFromListing,
  isNewgradEligible,
  JOB_LISTING_INSTRUCTION,
  parseJobListing,
  chunkText,
  htmlToText,
  type JobPostingItem,
} from '@tirocinium/companies';
import { config } from '../config.js';
import { createCompleter, type Completer } from './llm-completer.js';
import { PoliteFetcher } from './fetcher.js';
import { loadNewsSources, selectActiveNewsSources, type NewsSourceConfig } from './news-config.js';
import { insertNewJobPostings, replaceJobPostings, markNotified, type StoredJobPosting } from './job-postings-repo.js';
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

/**
 * 求人ニュース クロールを実行する。 sourceId 指定で 1 ソースに絞れる。
 * injectedSources を渡すと news-sources.json ではなくその配列をそのまま使う
 * (enrich-chain がアドホックな recruit-page ソースを流すための注入口。 active 判定はスキップ)。
 */
export async function runJobNewsCrawl(
  sourceId?: string,
  injectedSources?: NewsSourceConfig[],
): Promise<JobNewsCrawlSummary> {
  const summary: JobNewsCrawlSummary = {
    sources: [],
    fetched: 0,
    discovered: 0,
    inserted: 0,
    notified: 0,
    robotsBlocked: 0,
    errors: [],
  };

  const sources = injectedSources ?? selectActiveNewsSources(await loadNewsSources(), sourceId);
  if (sources.length === 0) return summary;

  const fetcher = new PoliteFetcher({
    userAgent: config.companyCrawl.userAgent,
    fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
    minIntervalMs: config.companyCrawl.minIntervalMs,
    respectRobots: config.companyCrawl.respectRobots,
  });

  // job-listing は LLM 抽出が必須。 cli backend (claude -p、 鍵不要) か API キーがあれば利用可。
  const llmReady = config.llmBackend === 'cli' || Boolean(process.env['ANTHROPIC_API_KEY']);
  const complete = llmReady ? createCompleter('EXTRACTOR').complete : null;

  const added: StoredJobPosting[] = [];
  for (const source of sources) {
    summary.sources.push(source.id);
    const collected: JobPostingItem[] = [];
    for (const url of source.urls) {
      try {
        collected.push(...(await crawlSourceUrl(source, url, fetcher, complete, summary)));
      } catch (err) {
        summary.errors.push({ url, message: (err as Error).message });
      }
    }
    // 同一 run 内の重複キーを畳む (同じ求人が複数チャンク / フィードに出るケース)。
    const deduped = dedupeByKey(collected);
    summary.discovered += deduped.length;
    // job-listing / recruit-page は「現在の掲載」スナップショットで置換 (重複累積を防ぐ)。
    // rss はニュースログとして追記。
    const newItems = source.kind === 'rss'
      ? await insertNewJobPostings(deduped)
      : await replaceJobPostings(source.id, deduped);
    added.push(...newItems);
  }
  summary.inserted = added.length;

  // 新着を Nuntius 通知 (宛先未設定なら no-op、 その場合 notified は立てない)。
  if (added.length > 0) {
    const res = await notifyJobPostings(added);
    if (res.sent) {
      await markNotified(added.map((p) => p.id));
      summary.notified = added.length;
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
  complete: Completer | null,
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

  // job-listing / recruit-page: LLM 抽出 (利用不可なら error 記録)。
  if (!complete) {
    summary.errors.push({ url, message: `${source.kind} は LLM 抽出が必須 (claude CLI backend か ANTHROPIC_API_KEY)` });
    return [];
  }
  // recruit-page は企業の自社採用ページ → 各求人に社名表記が無くても source.company で固定する。
  const buildOpts = source.kind === 'recruit-page'
    ? { companyName: source.company, kind: 'recruit-page' as const }
    : undefined;
  // 新卒フィルタ: aggregator (job-listing) は新卒関連だけに絞る。 recruit-page は
  // ユーザが明示登録した特定企業を追うソースなので既定で全求人を拾う (newgradOnly=false)。
  // source.newgradOnly で明示上書きできる (news-config が kind 別の既定を決める)。
  const newgradOnly = source.newgradOnly;
  const fullText = htmlToText(res.html, config.companyCrawl.listingMaxChars);
  const chunks = chunkText(fullText, config.companyCrawl.listingChunkChars, config.companyCrawl.listingMaxChunks);
  const out: JobPostingItem[] = [];
  for (const chunk of chunks) {
    const entries = parseJobListing(await complete(JOB_LISTING_INSTRUCTION, chunk));
    for (const entry of entries) {
      // newgradOnly のソースは新卒採用 / 新卒応募可 / 未経験可 の求人だけを残す (Tr は新卒就活向け)。
      if (newgradOnly && !isNewgradEligible(entry)) continue;
      const jp = jobPostingFromListing(source.id, url, entry, buildOpts);
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
