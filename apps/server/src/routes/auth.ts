// /api/auth — Cernere 埋め込みログイン (composite) の入口。認証ミドルウェアの対象外。
//   POST /cernere/login | /cernere/register | /cernere/mfa-verify  … <CompositeLogin> の authApi (Cernere へ代理)
//   POST /exchange {authCode}       … Tirocinium 向け token + refreshToken を返す
//   POST /refresh  {refreshToken}   … token を取り直す
// トークン・パスワードはログに出さない。

import { Hono, type Context } from 'hono';
import { CernereNotConfiguredError, cernereCompositeProxy, type CompositeAuthProxy } from '../auth/cernere-project-client.js';
import { CernereSessionError, exchangeAuthCode, refreshSession, type FetchLike } from '../auth/cernere-session.js';

export type AuthRouteDeps = {
  proxy: CompositeAuthProxy;
  fetchImpl?: FetchLike;
};

async function body(c: Context): Promise<Record<string, unknown>> {
  const b = (await c.req.json().catch(() => null)) as unknown;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

function fail(c: Context, err: unknown) {
  if (err instanceof CernereNotConfiguredError) return c.json({ error: 'login_not_configured' }, 503);
  if (err instanceof CernereSessionError) return c.json({ error: err.message }, err.status as 401 | 502 | 503);
  // Cernere が返したエラー文 (認証失敗など) はそのまま利用者へ見せる
  return c.json({ error: err instanceof Error ? err.message : 'login_failed' }, 400);
}

export function buildAuthRoutes(deps: AuthRouteDeps): Hono {
  const app = new Hono();

  app.post('/cernere/login', async (c) => {
    const b = await body(c);
    if (!text(b['email']) || !text(b['password'])) return c.json({ error: 'email と password が必要です' }, 400);
    try {
      return c.json(await deps.proxy.login(text(b['email']), text(b['password'])));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/cernere/register', async (c) => {
    const b = await body(c);
    if (!text(b['name']) || !text(b['email']) || !text(b['password'])) return c.json({ error: 'name と email と password が必要です' }, 400);
    try {
      return c.json(await deps.proxy.register(text(b['name']), text(b['email']), text(b['password'])));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/cernere/mfa-verify', async (c) => {
    const b = await body(c);
    if (!text(b['mfaToken']) || !text(b['method']) || !text(b['code'])) return c.json({ error: 'mfaToken と method と code が必要です' }, 400);
    try {
      return c.json(await deps.proxy.mfaVerify(text(b['mfaToken']), text(b['method']), text(b['code'])));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/exchange', async (c) => {
    const authCode = text((await body(c))['authCode']);
    if (!authCode) return c.json({ error: 'authCode が必要です' }, 400);
    try {
      return c.json(await exchangeAuthCode(authCode, deps.fetchImpl));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/refresh', async (c) => {
    const refreshToken = text((await body(c))['refreshToken']);
    if (!refreshToken) return c.json({ error: 'refreshToken が必要です' }, 400);
    try {
      return c.json(await refreshSession(refreshToken, deps.fetchImpl));
    } catch (err) {
      return fail(c, err);
    }
  });

  return app;
}

export const authRoutes = buildAuthRoutes({ proxy: cernereCompositeProxy });
