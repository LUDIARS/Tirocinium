// 実SQLiteで台帳のclaimを検証する。外向き送信は注入したfetchのみ。
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { config } from '../config.js';
import { initSql, sql } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { deliverInternshipNews } from './job-news-webhook.js';

const dbPath = join(tmpdir(), `tr-intern-${randomUUID()}.sqlite`);
const previousDatabase = config.databaseUrl;
const previousWebhook = config.jobNews.discordWebhookUrl;

beforeAll(async () => {
  config.databaseUrl = dbPath;
  config.jobNews.discordWebhookUrl = 'https://discord.com/api/webhooks/123/test';
  initSql();
  await runMigrations();
});

beforeEach(async () => {
  await sql`DELETE FROM job_news_webhook_deliveries`;
  await sql`DELETE FROM job_postings`;
  await insertPosting();
});

afterAll(async () => {
  await sql.end();
  config.databaseUrl = previousDatabase;
  config.jobNews.discordWebhookUrl = previousWebhook;
  for (const suffix of ['', '-shm', '-wal']) rmSync(dbPath + suffix, { force: true });
});

async function insertPosting(): Promise<void> {
  await sql`INSERT INTO job_postings (source, dedup_key, url, title)
    VALUES ('test', 'intern-key', 'https://example.com/intern', 'インターン募集')`;
}

describe('durable internship delivery', () => {
  it('claims once across concurrent runs and keeps the claim across snapshot replacement', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 200 }));
    const results = await Promise.all([deliverInternshipNews(fetcher), deliverInternshipNews(fetcher)]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await sql`DELETE FROM job_postings`;
    await insertPosting();
    expect((await deliverInternshipNews(fetcher)).sent).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not retry unknown or interrupted sending states', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout'));
    expect((await deliverInternshipNews(fetcher)).stopped).toBe(true);
    await deliverInternshipNews(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await sql`UPDATE job_news_webhook_deliveries SET state = 'sending'`;
    await deliverInternshipNews(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries only explicit rejection on a later invocation', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    expect((await deliverInternshipNews(fetcher)).stopped).toBe(true);
    expect((await deliverInternshipNews(fetcher)).sent).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
