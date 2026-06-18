// 求人ニュースの定期クロール。 config.jobNews.enabled のときだけ起動する。
// 新着検出 + Nuntius 通知は runJobNewsCrawl が行う。 礼節のため間隔は長め (既定 6h)。

import { config } from '../config.js';
import { runJobNewsCrawl } from './job-news-crawler.js';

let timer: ReturnType<typeof setInterval> | null = null;

async function runOnce(): Promise<void> {
  try {
    const s = await runJobNewsCrawl();
    if (s.inserted > 0) {
      console.log(`[job-news] 新着 ${s.inserted} 件 (notified=${s.notified})`);
    }
  } catch (err) {
    console.error('[job-news] crawl error', err);
  }
}

/** 求人ニュースの定期クロールを開始する (enabled=false なら何もしない)。 */
export function startJobNewsQueue(): void {
  if (timer) return;
  if (!config.jobNews.enabled) {
    console.log('[job-news] queue disabled (COMPANY_JOB_NEWS_ENABLED=1 で有効化)');
    return;
  }
  const interval = Math.max(config.jobNews.intervalMs, 60_000);
  timer = setInterval(() => void runOnce(), interval);
  // setInterval がプロセスを生かし続けないよう unref (Node のみ)。
  (timer as { unref?: () => void }).unref?.();
  // 起動直後に 1 回 (起動直後の負荷を避けるため少し遅延)。
  setTimeout(() => void runOnce(), 30_000).unref?.();
  console.log(`[job-news] queue started interval=${Math.round(interval / 60_000)}min`);
}

export function stopJobNewsQueue(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
