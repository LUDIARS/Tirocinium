import type { Context, MiddlewareHandler } from 'hono';
import { V4 } from 'paseto';
import { config } from '../config.js';

export type CernerePayload = {
  sub: string;
  aud: string;
  iat: string;
  exp: string;
  scopes?: string[];
};

export type AuthedUser = { id: string };

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthedUser;
  }
}

export const cernereAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = header.slice(7);

  if (!config.cernerePublicKey) {
    // 開発時の安全弁: 鍵未設定なら 503 にして「沈黙の素通し」を防ぐ
    return c.json({ error: 'auth_not_configured' }, 503);
  }

  let payload: CernerePayload;
  try {
    payload = (await V4.verify(token, config.cernerePublicKey, {
      audience: config.cernereAudience,
    })) as CernerePayload;
  } catch (err) {
    return c.json({ error: 'invalid_token' }, 401);
  }

  // PASETO iat/exp は ISO 文字列で来る (LUDIARS 規約)。 念のため exp チェック。
  if (payload.exp && Date.parse(payload.exp) < Date.now()) {
    return c.json({ error: 'expired' }, 401);
  }

  c.set('user', { id: payload.sub });
  await next();
};
