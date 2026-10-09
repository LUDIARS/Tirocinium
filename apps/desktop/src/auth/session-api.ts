// Tirocinium サーバの /api/auth (Cernere 埋め込みログインの入口) を呼ぶ。
// <CompositeLogin> の authApi と、authCode の交換・token の取り直しを持つ。
import type { CompositeAuthApi } from '@ludiars/cernere-composite/ui';
import { SERVER_URL } from '../config.js';

export type TrSession = {
  token: string;
  expiresIn: number;
  refreshToken: string;
  user: { id: string; displayName: string };
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `ログインに失敗しました (HTTP ${res.status})`);
  return data as T;
}

/** ブラウザから Cernere を直接呼ばず、Tirocinium サーバ経由で代理する (CORS 回避、Actio と同じ形)。 */
export const compositeAuthApi: CompositeAuthApi = {
  login: (params) => post('/cernere/login', params),
  register: (params) => post('/cernere/register', params),
  mfaVerify: (params) => post('/cernere/mfa-verify', params),
};

export const exchangeAuthCode = (authCode: string) => post<TrSession>('/exchange', { authCode });
export const refreshTrSession = (refreshToken: string) => post<TrSession>('/refresh', { refreshToken });
