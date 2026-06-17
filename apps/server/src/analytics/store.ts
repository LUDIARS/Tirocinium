import { sql } from '../db/index.js';
import type { AnalyticsEvent, DailySummary, DailyTrend } from '@tirocinium/analytics';

export type { AnalyticsEvent, DailySummary, DailyTrend };

export function detectBrowser(ua: string): string {
  if (!ua) return 'Unknown';
  if (/Edg\/|Edge\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'Chrome';
  if (/Chromium\//.test(ua)) return 'Chromium';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  return 'Other';
}

export async function insertEvent(e: AnalyticsEvent): Promise<void> {
  await sql`
    INSERT INTO analytics_events
      (event_type, path, entity_id, entity_name, ip, browser, user_agent, referrer)
    VALUES
      (${e.event_type}, ${e.path},
       ${e.entity_id ?? null}, ${e.entity_name ?? null},
       ${e.ip}, ${e.browser}, ${e.user_agent}, ${e.referrer})
  `;
}

export async function getDailySummary(date: string): Promise<DailySummary> {
  const [totals] = await sql<{ total_events: number; unique_ips: number }[]>`
    SELECT COUNT(*) AS total_events, COUNT(DISTINCT ip) AS unique_ips
    FROM analytics_events
    WHERE date(ts) = ${date}
  `;

  const page_views = await sql<{ path: string; views: number }[]>`
    SELECT path, COUNT(*) AS views
    FROM analytics_events
    WHERE date(ts) = ${date} AND event_type = 'page_view'
    GROUP BY path
    ORDER BY views DESC
  `;

  const top_companies = await sql<{ entity_id: string; entity_name: string; views: number }[]>`
    SELECT entity_id, entity_name, COUNT(*) AS views
    FROM analytics_events
    WHERE date(ts) = ${date} AND event_type = 'company_view'
      AND entity_id IS NOT NULL
    GROUP BY entity_id, entity_name
    ORDER BY views DESC
    LIMIT 20
  `;

  const browsers = await sql<{ browser: string; count: number }[]>`
    SELECT browser, COUNT(*) AS count
    FROM analytics_events
    WHERE date(ts) = ${date}
    GROUP BY browser
    ORDER BY count DESC
  `;

  return {
    date,
    total_events: totals?.total_events ?? 0,
    unique_ips: totals?.unique_ips ?? 0,
    page_views,
    top_companies,
    browsers,
  };
}

export async function getRecentTrend(days: number): Promise<DailyTrend[]> {
  return sql<DailyTrend[]>`
    SELECT date(ts) AS date,
           COUNT(*)          AS total,
           COUNT(DISTINCT ip) AS unique_ips
    FROM analytics_events
    WHERE ts >= datetime('now', ${`-${days} days`})
    GROUP BY date(ts)
    ORDER BY date ASC
  `;
}
