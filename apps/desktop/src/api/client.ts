import { SERVER_URL } from '../config.js';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: unknown) {
    super(message);
  }
}

/**
 * 401 のときに呼ぶ関数 (AuthProvider が登録する)。セッションは延長しないので、
 * 期限切れ・失効はログアウトしてログイン画面へ戻すだけにする。
 */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn;
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
  const res = await send(url, init, token);

  // セッションが切れた・失効した。dev token は対象外。
  if (res.status === 401 && token && token !== 'dev') onUnauthorized?.();

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
