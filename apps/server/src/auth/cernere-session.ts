// 埋め込みログインの authCode を Tirocinium 向けトークンに変える。
// 1. Cernere /api/auth/exchange で authCode → ユーザーの accessToken / refreshToken
// 2. Cernere /api/auth/project-token で accessToken → Tirocinium 向けの user×project token
//    (PASETO V4、aud = config.cernereAudience、15 分)。サーバの認証ミドルウェアはこれを検証する。
// refresh は Cernere /api/auth/refresh → project-token の取り直し。
// トークンは返すだけで保存しない (個人データ・認証トークンは Tirocinium の責務外)。

import { config } from '../config.js';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type TrSession = {
  token: string;
  expiresIn: number;
  refreshToken: string;
  user: { id: string; displayName: string };
};

export class CernereSessionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function post(fetchImpl: FetchLike, url: string, body: unknown, bearer?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Cernere の応答は { data: {...} } で包まれる経路があるので両方を受ける
  const payload = (data['data'] && typeof data['data'] === 'object' ? data['data'] : data) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof payload['error'] === 'string' ? payload['error'] : `HTTP ${res.status}`;
    throw new CernereSessionError(`Cernere ${new URL(url).pathname} failed: ${reason}`, res.status === 401 || res.status === 400 ? 401 : 502);
  }
  return payload;
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v) throw new CernereSessionError(`Cernere response has no ${what}`, 502);
  return v;
}

function baseUrl(): string {
  if (!config.cernere.url) throw new CernereSessionError('CERNERE_URL is not configured', 503);
  return config.cernere.url;
}

async function projectToken(fetchImpl: FetchLike, accessToken: string): Promise<{ token: string; expiresIn: number; userId: string; displayName: string }> {
  const r = await post(fetchImpl, `${baseUrl()}/api/auth/project-token`, { project_key: 'tirocinium', hub_url: config.cernereAudience }, accessToken);
  return {
    token: str(r['accessToken'], 'project token'),
    expiresIn: typeof r['expiresIn'] === 'number' ? r['expiresIn'] : 900,
    userId: str(r['userId'], 'userId'),
    displayName: typeof r['displayName'] === 'string' ? r['displayName'] : '',
  };
}

export async function exchangeAuthCode(authCode: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<TrSession> {
  const ex = await post(fetchImpl, `${baseUrl()}/api/auth/exchange`, { code: authCode });
  const accessToken = str(ex['accessToken'], 'accessToken');
  const refreshToken = str(ex['refreshToken'], 'refreshToken');
  const pt = await projectToken(fetchImpl, accessToken);
  return { token: pt.token, expiresIn: pt.expiresIn, refreshToken, user: { id: pt.userId, displayName: pt.displayName } };
}

export async function refreshSession(refreshToken: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<TrSession> {
  const r = await post(fetchImpl, `${baseUrl()}/api/auth/refresh`, { refreshToken });
  const accessToken = str(r['accessToken'], 'accessToken');
  // Cernere は refresh で refreshToken も回す。返ってこなければ元のものを使い続ける
  const nextRefresh = typeof r['refreshToken'] === 'string' && r['refreshToken'] ? r['refreshToken'] : refreshToken;
  const pt = await projectToken(fetchImpl, accessToken);
  return { token: pt.token, expiresIn: pt.expiresIn, refreshToken: nextRefresh, user: { id: pt.userId, displayName: pt.displayName } };
}
