// 求人ニュースの定期クロール。 config.jobNews.enabled のときだけ起動する。
// 毎朝 dailyHour 時台に 1 回だけクロールする (新着検出 + Nuntius 通知は runJobNewsCrawl が行う)。

import { config } from '../config.js';
import { runJobNewsCrawl } from './job-news-crawler.js';
import { sql } from '../db/index.js';
import { newsDayAt } from './job-news-schedule.js';
import { validateJobNewsWebhook } from './job-news-webhook-transport.js';

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunDay = ''; // 当日 1 回に絞るためのローカル日付キー
let running = false;

async function runOnce(day: string): Promise<void> {
  try {
    const claimed = await sql<{ day_key: string }[]>`
      INSERT INTO job_news_daily_runs (day_key, started_at)
      VALUES (${day}, ${new Date().toISOString()})
      ON CONFLICT (day_key) DO NOTHING RETURNING day_key
    `;
    lastRunDay = day;
    if (!claimed.length) return;
    const s = await runJobNewsCrawl();
    console.log(`[job-news] 朝の取得: discovered=${s.discovered} 新着=${s.inserted} notified=${s.notified} deliveryStopped=${s.webhookStopped}`);
  } catch (err) {
    console.error('[job-news] crawl error', err);
  } finally {
    running = false;
  }
}

/** 毎朝 dailyHour 時台に 1 回クロールする (enabled=false なら何もしない)。 */
export function startJobNewsQueue(): void {
  if (timer) return;
  if (!config.jobNews.enabled) {
    console.log('[job-news] queue disabled (COMPANY_JOB_NEWS_ENABLED=1 で有効化)');
    return;
  }
  // 有効化時に不正設定を即座に知らせる。秘密URLは例外へ含めない。
  newsDayAt(new Date(), config.jobNews.dailyHour, config.jobNews.timeZone);
  if (config.jobNews.discordWebhookUrl) validateJobNewsWebhook(config.jobNews.discordWebhookUrl);
  const check = (): void => {
    const now = new Date();
    const day = newsDayAt(now, config.jobNews.dailyHour, config.jobNews.timeZone);
    if (!day || day === lastRunDay || running) return;
    running = true;
    void runOnce(day);
  };
  // 30 分ごとに時刻を確認し、 朝の時間帯に入った最初の 1 回だけ走らせる。
  timer = setInterval(check, 30 * 60_000);
  (timer as { unref?: () => void }).unref?.();
  check(); // 起動時が既に朝の時間帯なら即 1 回
  console.log(`[job-news] queue started: 毎朝 ${config.jobNews.dailyHour} 時以降 (${config.jobNews.timeZone}) に取得`);
}

export function stopJobNewsQueue(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
