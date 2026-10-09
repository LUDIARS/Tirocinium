import { SERVER_URL } from '../config.js';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: unknown) {
    super(message);
  }
}

/** 401 のときに新しい token を返す関数 (AuthProvider が登録する)。取り直せなければ null。 */
type TokenRefresher = () => Promise<string | null>;
let refresher: TokenRefresher | null = null;
let refreshing: Promise<string | null> | null = null;

export function setTokenRefresher(fn: TokenRefresher | null): void {
  refresher = fn;
}

/** 同時に複数の API が 401 になっても、取り直しは 1 回にまとめる。 */
function refreshOnce(): Promise<string | null> {
  if (!refresher) return Promise.resolve(null);
  refreshing ??= refresher().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function send(url: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers['authorization'] = `Bearer ${token}`;
  return fetch(url, { ...init, headers });
}

export async function fetchJson<T>(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http') ? path : `${SERVER_URL}${path}`;
  let res = await send(url, init, token);

  // token (15 分) が切れたら 1 回だけ取り直して再試行する。dev token は対象外。
  if (res.status === 401 && token && token !== 'dev') {
    const next = await refreshOnce();
    if (next) res = await send(url, init, next);
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    throw new ApiError(`HTTP ${res.status} ${res.statusText}`, res.status, body);
  }
  return (await res.json()) as T;
}
