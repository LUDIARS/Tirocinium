import { Hono } from 'hono';
import { detectBrowser, getDailySummary, getRecentTrend, insertEvent } from '../analytics/store.js';

export const analyticsRoute = new Hono();

analyticsRoute.post('/event', async (c) => {
  const body = await c.req.json<{
    event_type: 'page_view' | 'company_view';
    path: string;
    entity_id?: string;
    entity_name?: string;
    referrer?: string;
  }>();

  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';
  const ua = c.req.header('user-agent') ?? '';
  const browser = detectBrowser(ua);

  await insertEvent({
    event_type: body.event_type,
    path: body.path,
    entity_id: body.entity_id,
    entity_name: body.entity_name,
    ip,
    browser,
    user_agent: ua,
    referrer: body.referrer ?? '',
  });

  return c.json({ ok: true });
});

analyticsRoute.get('/daily', async (c) => {
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const summary = await getDailySummary(date);
  return c.json(summary);
});

analyticsRoute.get('/trend', async (c) => {
  const days = Math.min(parseInt(c.req.query('days') ?? '14', 10), 90);
  const trend = await getRecentTrend(days);
  return c.json({ trend });
});
