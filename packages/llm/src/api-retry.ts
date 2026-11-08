import { HttpError } from '@ludiars/portus/net';

// 直接 API (Anthropic / OpenAI) の再試行。旧 SDK が既定で行っていた再試行 (最大 2 回、
// 408 / 409 / 429 / 5xx と接続失敗・タイムアウト、指数バックオフ + ゆらぎ) を同じ条件で残す。
// Portus のクライアントは再試行しないので、ここで包む。

export const MAX_RETRIES = 2;

const RETRY_STATUS = new Set([408, 409, 429]);

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) return RETRY_STATUS.has(err.status) || err.status >= 500;
  if (!(err instanceof Error)) return false;
  // fetch の接続失敗は TypeError、AbortSignal.timeout は TimeoutError。呼び出し側の中断 (AbortError) は再試行しない。
  return err instanceof TypeError || err.name === 'TimeoutError';
}

/** attempt 回目 (0 始まり) の待ち時間。0.5 秒 × 2^attempt (上限 8 秒) を最大 25% 短くする */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(500 * 2 ** attempt, 8000);
  return Math.round(base * (1 - random() * 0.25));
}

export type RetryOptions = {
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(call: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryable(err)) throw err;
      await sleep(retryDelayMs(attempt, opts.random));
    }
  }
}
