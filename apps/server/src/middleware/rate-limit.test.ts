import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimit } from './rate-limit.js';

function makeApp(max: number, windowMs = 1000) {
  const app = new Hono();
  const limiter = rateLimit({ windowMs, max, keyFn: (c) => c.req.header('x-user') ?? 'anon' });
  app.post('/', limiter, (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  it('max 以内は通し、超過で 429 + Retry-After を返す', async () => {
    const app = makeApp(2);
    const h = { 'x-user': 'u1' };
    expect((await app.request('/', { method: 'POST', headers: h })).status).toBe(200);
    expect((await app.request('/', { method: 'POST', headers: h })).status).toBe(200);
    const blocked = await app.request('/', { method: 'POST', headers: h });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    const body = await blocked.json();
    expect(body.error).toBe('rate_limited');
    expect(typeof body.retry_after_sec).toBe('number');
  });

  it('キーが異なれば独立してカウントする', async () => {
    const app = makeApp(1);
    expect((await app.request('/', { method: 'POST', headers: { 'x-user': 'a' } })).status).toBe(200);
    // a は使い切ったが b は別カウント
    expect((await app.request('/', { method: 'POST', headers: { 'x-user': 'b' } })).status).toBe(200);
    expect((await app.request('/', { method: 'POST', headers: { 'x-user': 'a' } })).status).toBe(429);
  });

  it('ウィンドウ経過後はリセットされる', async () => {
    const app = makeApp(1, 20); // 20ms ウィンドウ
    expect((await app.request('/', { method: 'POST', headers: { 'x-user': 'z' } })).status).toBe(200);
    expect((await app.request('/', { method: 'POST', headers: { 'x-user': 'z' } })).status).toBe(429);
    await new Promise((r) => setTimeout(r, 30));
    expect((await app.request('/', { method: 'POST', headers: { 'x-user': 'z' } })).status).toBe(200);
  });
});
