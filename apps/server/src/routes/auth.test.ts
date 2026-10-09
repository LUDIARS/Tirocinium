import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { ed25519FromRaw, parsePublicKeySet } from '../auth/cernere-public-keys.js';
import type { FetchLike } from '../auth/cernere-session.js';
import type { CompositeAuthProxy } from '../auth/cernere-project-client.js';
import { buildAuthRoutes } from './auth.js';

type Call = { url: string; headers: Record<string, string>; body: unknown };

function fakeCernere(responses: Record<string, { status: number; body: unknown }>): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const r = responses[new URL(url).pathname] ?? { status: 404, body: {} };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  return { fetchImpl, calls };
}

const proxy: CompositeAuthProxy = {
  login: async (email) => (email === 'mfa@test' ? { mfaRequired: true, mfaToken: 'm1', mfaMethods: ['totp'] } : { authCode: 'code-1' }),
  register: async () => ({ authCode: 'code-2' }),
  mfaVerify: async () => ({ authCode: 'code-3' }),
};

const post = (app: ReturnType<typeof buildAuthRoutes>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  config.cernere.url = 'https://cr.example.test';
  config.cernereAudience = 'tirocinium';
});

describe('/api/auth (Cernere composite login)', () => {
  it('relays composite login, register and MFA to Cernere and returns the authCode or MFA challenge', async () => {
    const app = buildAuthRoutes({ proxy });
    expect(await (await post(app, '/cernere/login', { email: 'a@test', password: 'p' })).json()).toEqual({ authCode: 'code-1' });
    expect(await (await post(app, '/cernere/login', { email: 'mfa@test', password: 'p' })).json()).toMatchObject({ mfaRequired: true, mfaToken: 'm1' });
    expect(await (await post(app, '/cernere/register', { name: 'n', email: 'a@test', password: 'p' })).json()).toEqual({ authCode: 'code-2' });
    expect(await (await post(app, '/cernere/mfa-verify', { mfaToken: 'm1', method: 'totp', code: '123456' })).json()).toEqual({ authCode: 'code-3' });
    expect((await post(app, '/cernere/login', { email: 'a@test' })).status).toBe(400);
  });

  it('exchanges an authCode for a Tirocinium user×project token scoped to the configured audience', async () => {
    const { fetchImpl, calls } = fakeCernere({
      '/api/auth/exchange': { status: 200, body: { accessToken: 'user-at', refreshToken: 'user-rt', user: { id: 'u1' } } },
      '/api/auth/project-token': { status: 200, body: { accessToken: 'v4.public.tr', expiresIn: 900, userId: 'u1', displayName: '佐倉' } },
    });
    const res = await post(buildAuthRoutes({ proxy, fetchImpl }), '/exchange', { authCode: 'code-1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'v4.public.tr', expiresIn: 900, refreshToken: 'user-rt', user: { id: 'u1', displayName: '佐倉' } });
    expect(calls[0]).toMatchObject({ url: 'https://cr.example.test/api/auth/exchange', body: { code: 'code-1' } });
    expect(calls[1]).toMatchObject({
      url: 'https://cr.example.test/api/auth/project-token',
      headers: { authorization: 'Bearer user-at' },
      body: { project_key: 'tirocinium', hub_url: 'tirocinium' },
    });
  });

  it('refreshes through Cernere and keeps the old refresh token when none is rotated', async () => {
    const { fetchImpl } = fakeCernere({
      '/api/auth/refresh': { status: 200, body: { data: { accessToken: 'user-at2' } } },
      '/api/auth/project-token': { status: 200, body: { data: { accessToken: 'v4.public.tr2', expiresIn: 900, userId: 'u1' } } },
    });
    const res = await post(buildAuthRoutes({ proxy, fetchImpl }), '/refresh', { refreshToken: 'user-rt' });
    expect(await res.json()).toMatchObject({ token: 'v4.public.tr2', refreshToken: 'user-rt', user: { id: 'u1' } });
  });

  it('maps a rejected authCode to 401 and a missing Cernere URL to 503', async () => {
    const { fetchImpl } = fakeCernere({ '/api/auth/exchange': { status: 401, body: { error: 'invalid code' } } });
    expect((await post(buildAuthRoutes({ proxy, fetchImpl }), '/exchange', { authCode: 'bad' })).status).toBe(401);
    config.cernere.url = '';
    expect((await post(buildAuthRoutes({ proxy, fetchImpl }), '/exchange', { authCode: 'x' })).status).toBe(503);
    expect((await post(buildAuthRoutes({ proxy, fetchImpl }), '/exchange', {})).status).toBe(400);
  });
});

describe('Cernere public key set', () => {
  it('turns the raw Ed25519 keys of /.well-known/cernere-public-key into key objects', () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url').toString('base64');
    const keys = parsePublicKeySet({ keys: [{ kid: 'k1', alg: 'EdDSA', public_key: raw, current: true }, { kid: 'x', alg: 'RS256', public_key: raw }] });
    expect(keys).toHaveLength(1);
    expect(keys[0]!.asymmetricKeyType).toBe('ed25519');
    expect(parsePublicKeySet({})).toEqual([]);
    expect(() => ed25519FromRaw(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
  });
});
