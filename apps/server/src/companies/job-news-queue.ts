// 求人ニュースの定期クロール。 config.jobNews.enabled のときだけ起動する。
// 毎朝 dailyHour 時台に 1 回だけクロールする (新着検出 + Nuntius 通知は runJobNewsCrawl が行う)。

import { config } from '../config.js';
import { runJobNewsCrawl } from './job-news-crawler.js';

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunDay = ''; // 当日 1 回に絞るためのローカル日付キー

async function runOnce(): Promise<void> {
  try {
    const s = await runJobNewsCrawl();
    console.log(`[job-news] 朝の取得: discovered=${s.discovered} 新着=${s.inserted} notified=${s.notified}`);
  } catch (err) {
    console.error('[job-news] crawl error', err);
  }
}

/** ローカル日付キー (YYYY-M-D)。 「その日もう走ったか」 の判定に使う。 */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 毎朝 dailyHour 時台に 1 回クロールする (enabled=false なら何もしない)。 */
export function startJobNewsQueue(): void {
  if (timer) return;
  if (!config.jobNews.enabled) {
    console.log('[job-news] queue disabled (COMPANY_JOB_NEWS_ENABLED=1 で有効化)');
    return;
  }
  const check = (): void => {
    const now = new Date();
    if (now.getHours() !== config.jobNews.dailyHour) return; // 朝の時間帯のみ
    const day = localDayKey(now);
    if (day === lastRunDay) return; // その日は実行済み
    lastRunDay = day;
    void runOnce();
  };
  // 30 分ごとに時刻を確認し、 朝の時間帯に入った最初の 1 回だけ走らせる。
  timer = setInterval(check, 30 * 60_000);
  (timer as { unref?: () => void }).unref?.();
  check(); // 起動時が既に朝の時間帯なら即 1 回
  console.log(`[job-news] queue started: 毎朝 ${config.jobNews.dailyHour} 時台に取得`);
}

export function stopJobNewsQueue(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
