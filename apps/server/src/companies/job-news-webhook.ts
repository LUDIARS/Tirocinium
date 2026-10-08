// インターン情報のWebhook配送。snapshotから独立したdedup_key台帳で再通知を防ぐ。
import { config } from '../config.js';
import { sql } from '../db/index.js';
import type { StoredJobPosting } from './job-postings-repo.js';
import { internshipMessage, isInternshipPosting } from './internship-message.js';
import { sendJobNewsWebhook, validateJobNewsWebhook } from './job-news-webhook-transport.js';

export async function deliverInternshipNews(fetcher: typeof fetch = fetch): Promise<{ sent: number; stopped: boolean }> {
  if (!config.jobNews.discordWebhookUrl) return { sent: 0, stopped: false };
  const endpoint = validateJobNewsWebhook(config.jobNews.discordWebhookUrl);
  const items = await sql<(StoredJobPosting & { dedup_key: string })[]>`
    SELECT p.* FROM job_postings p
    LEFT JOIN job_news_webhook_deliveries d ON d.dedup_key = p.dedup_key
    WHERE (d.dedup_key IS NULL OR d.state = 'failed')
      AND (p.title LIKE '%インターン%' OR p.snippet LIKE '%インターン%'
        OR p.employment_type LIKE '%インターン%'
        OR lower(p.title || p.snippet || p.employment_type) LIKE '%internship%'
        OR p.title || p.snippet || p.employment_type LIKE '%仕事体験%'
        OR p.title || p.snippet || p.employment_type LIKE '%カンパニー%')
    ORDER BY p.first_seen_at DESC LIMIT 500
  `;
  let sent = 0;
  for (const item of items) {
    if (sent >= 100) break;
    if (!isInternshipPosting(item)) continue;
    const content = internshipMessage(item);
    const now = new Date().toISOString();
    const claimed = await sql<{ dedup_key: string }[]>`
      INSERT INTO job_news_webhook_deliveries (dedup_key, state, updated_at)
      VALUES (${item.dedup_key}, 'sending', ${now})
      ON CONFLICT (dedup_key) DO UPDATE SET state = 'sending', updated_at = ${now}
        WHERE job_news_webhook_deliveries.state = 'failed'
      RETURNING dedup_key
    `;
    if (!claimed.length) continue;
    const state = await sendJobNewsWebhook(endpoint, content, fetcher);
    await sql`UPDATE job_news_webhook_deliveries SET state = ${state}, updated_at = ${new Date().toISOString()}
      WHERE dedup_key = ${item.dedup_key}`;
    if (state !== 'sent') return { sent, stopped: true };
    sent++;
  }
  return { sent, stopped: false };
}
