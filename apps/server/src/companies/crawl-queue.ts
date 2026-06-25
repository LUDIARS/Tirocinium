// 企業クロールキュー worker: crawl_jobs を待ち行列とみなし、 毎 tick で queued を 1 件だけ
// claim → runCrawl で企業を upsert する常駐処理。 Web 取得を直列にすることで重複リクエストの
// 無駄処理を避け、 対象サイトへの負荷も抑える。 spec/feature/companies/crawl-queue.md。

import { config } from '../config.js';
import { runCrawl } from './crawler.js';
import {
  claimNextCrawlJob,
  markCrawlDone,
  markCrawlFailed,
  crawlQueueCounts,
  recentCrawlJobs,
  type StoredCrawlJob,
} from './crawl-queue-repo.js';

export type CrawlQueueStatus = {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  /** 起動できない / 停止中の理由。 起動中は空。 */
  disabledReason: string;
  processed: number; // このプロセスで処理した件数
  upsertedOk: number; // 1 社以上 upsert できた件数
  lastUrl: string;
  lastDetail: string;
  counts: { queued: number; running: number; done: number; failed: number };
  recent: StoredCrawlJob[];
};

let timer: NodeJS.Timeout | null = null;
let ticking = false; // tick の多重実行防止
const state = { processed: 0, upsertedOk: 0, lastUrl: '', lastDetail: '' };

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const job = await claimNextCrawlJob();
    if (!job) return; // 取り出すものが無ければ何もしない
    state.processed++;
    state.lastUrl = job.url;
    try {
      // manual ソースは渡された URL をそのまま seed にする (sources.ts の manualSource)。
      const summary = await runCrawl({
        source: job.source,
        urls: [job.url],
        maxPages: job.max_pages ?? undefined,
      });
      await markCrawlDone(job.id, summary);
      const ok = summary.upserted > 0;
      if (ok) state.upsertedOk++;
      state.lastDetail = ok
        ? `${job.url}: ${summary.upserted} 社を取得`
        : `${job.url}: 企業情報を抽出できず (errors=${summary.errors.length})`;
    } catch (err) {
      const message = (err as Error).message;
      await markCrawlFailed(job.id, message, config.crawlQueue.maxAttempts);
      state.lastDetail = `${job.url}: クロール失敗 — ${message}`;
    }
    console.log(`[crawl-queue] ${state.lastDetail}`);
  } catch (err) {
    console.warn('[crawl-queue] tick error:', (err as Error).message);
  } finally {
    ticking = false;
  }
}

/** キューを起動する (無効なら no-op)。 サーバ boot から呼ぶ。 */
export function startCrawlQueue(): void {
  if (timer) return;
  if (!config.crawlQueue.enabled) {
    console.log('[crawl-queue] queue disabled');
    return;
  }
  console.log(`[crawl-queue] 起動 (${config.crawlQueue.intervalMs}ms 間隔で 1 件ずつ)`);
  timer = setInterval(() => void tick(), config.crawlQueue.intervalMs);
  if (typeof timer.unref === 'function') timer.unref(); // プロセス終了を妨げない
}

export function stopCrawlQueue(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function crawlQueueStatus(): Promise<CrawlQueueStatus> {
  const [counts, recent] = await Promise.all([crawlQueueCounts(), recentCrawlJobs()]);
  return {
    enabled: config.crawlQueue.enabled,
    running: timer !== null,
    intervalMs: config.crawlQueue.intervalMs,
    disabledReason: config.crawlQueue.enabled ? (timer ? '' : 'キューは停止中です') : 'キューは無効化されています',
    processed: state.processed,
    upsertedOk: state.upsertedOk,
    lastUrl: state.lastUrl,
    lastDetail: state.lastDetail,
    counts,
    recent,
  };
}
