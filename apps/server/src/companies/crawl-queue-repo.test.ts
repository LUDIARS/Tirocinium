// 実 SQLite に対して crawl-queue-repo を実走させる (fake DB ではなく実 SQL 経路を裏取りする)。
// migration 022 の DDL・active URL の重複畳み込み (uq_crawl_jobs_active_url)・
// claim→done/failed の status 遷移・再試行ロジックをまとめて検証する。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { config } from '../config.js';
import { initSql, sql } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import {
  enqueueCrawl,
  claimNextCrawlJob,
  markCrawlDone,
  markCrawlFailed,
  crawlQueueCounts,
  recentCrawlJobs,
} from './crawl-queue-repo.js';

const dbPath = join(tmpdir(), `tr-crawlq-${randomUUID()}.sqlite`);

beforeAll(async () => {
  config.databaseUrl = dbPath;
  initSql();
  await runMigrations();
});

afterAll(async () => {
  await sql.end();
  for (const suffix of ['', '-shm', '-wal']) {
    try { rmSync(dbPath + suffix); } catch { /* noop */ }
  }
});

describe('crawl-queue-repo (real sqlite)', () => {
  it('enqueue は queued ジョブを作る', async () => {
    const { job, deduped } = await enqueueCrawl({ url: 'https://a.test/', nameHint: 'A社', requestedBy: 'u1' });
    expect(deduped).toBe(false);
    expect(job.status).toBe('queued');
    expect(job.url).toBe('https://a.test/');
    expect(job.name_hint).toBe('A社');
    expect(job.requested_by).toBe('u1');
  });

  it('同一 URL が active な間は畳んで既存を返す (重複リクエストの無駄処理回避)', async () => {
    const first = await enqueueCrawl({ url: 'https://dup.test/' });
    const second = await enqueueCrawl({ url: 'https://dup.test/' });
    expect(second.deduped).toBe(true);
    expect(second.job.id).toBe(first.job.id);
  });

  it('claim は queued→running に進め attempts を増やす', async () => {
    await enqueueCrawl({ url: 'https://claim.test/' });
    // 先行ジョブを全部掃けるまで claim して目的の URL に到達する。
    let claimed = await claimNextCrawlJob();
    while (claimed && claimed.url !== 'https://claim.test/') claimed = await claimNextCrawlJob();
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('running');
    expect(claimed!.attempts).toBe(1);
    expect(claimed!.started_at).toBeTruthy();
  });

  it('done にすると summary が残り、 同 URL を再 enqueue できる', async () => {
    const { job } = await enqueueCrawl({ url: 'https://done.test/' });
    // この URL を running まで進める。
    let claimed = await claimNextCrawlJob();
    while (claimed && claimed.id !== job.id) claimed = await claimNextCrawlJob();
    await markCrawlDone(job.id, { source: 'manual', upserted: 1 });
    // done 後は active でないので同 URL を再投入できる (unique index は active のみ)。
    const again = await enqueueCrawl({ url: 'https://done.test/' });
    expect(again.deduped).toBe(false);
    expect(again.job.id).not.toBe(job.id);
  });

  it('failed は maxAttempts 未満なら queued に戻し、 到達で failed 確定', async () => {
    const { job } = await enqueueCrawl({ url: 'https://retry.test/' });
    let claimed = await claimNextCrawlJob();
    while (claimed && claimed.id !== job.id) claimed = await claimNextCrawlJob();
    // attempts=1 < maxAttempts=2 → queued に戻る
    await markCrawlFailed(job.id, 'boom', 2);
    let rows = await sql<{ status: string }[]>`SELECT status FROM crawl_jobs WHERE id = ${job.id}`;
    expect(rows[0]!.status).toBe('queued');
    // もう一度 claim (attempts=2) して失敗 → failed 確定
    claimed = await claimNextCrawlJob();
    while (claimed && claimed.id !== job.id) claimed = await claimNextCrawlJob();
    await markCrawlFailed(job.id, 'boom again', 2);
    rows = await sql<{ status: string }[]>`SELECT status FROM crawl_jobs WHERE id = ${job.id}`;
    expect(rows[0]!.status).toBe('failed');
  });

  it('counts と recent が取れる', async () => {
    const counts = await crawlQueueCounts();
    expect(counts.queued + counts.running + counts.done + counts.failed).toBeGreaterThan(0);
    const recent = await recentCrawlJobs(5);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThanOrEqual(5);
  });
});
