// 固定ウィンドウ方式のインメモリ rate limiter (追加依存なし)。
//
// セッション作成のような「重い / 乱用されると過負荷になる」エンドポイントを
// 1 ユーザ (or 任意キー) あたり windowMs / max で絞る。単一プロセス前提の
// 簡易実装。水平スケール時は Redis 等の共有ストアへ差し替えること。

import type { Context, MiddlewareHandler } from 'hono';

export interface RateLimitOptions {
  /** ウィンドウ長 (ms)。 */
  windowMs: number;
  /** ウィンドウ内の許容リクエスト数。 */
  max: number;
  /** レート制限キーの抽出関数 (例: 認証ユーザ ID)。 */
  keyFn: (c: Context) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * rate limiter ミドルウェアを生成する。閾値超過時は 429 + Retry-After を返す。
 * 戻り値の `.store` でバケットを直接参照できる (テスト用)。
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler & { store: Map<string, Bucket> } {
  const store = new Map<string, Bucket>();

  // 期限切れバケットの定期掃除。プロセス終了を妨げないよう unref。
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of store) {
      if (b.resetAt <= now) store.delete(k);
    }
  }, Math.max(opts.windowMs, 1_000));
  if (typeof sweeper.unref === 'function') sweeper.unref();

  const mw: MiddlewareHandler = async (c, next) => {
    const key = opts.keyFn(c);
    const now = Date.now();
    let b = store.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, b);
    }
    b.count += 1;
    if (b.count > opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return c.json({ error: 'rate_limited', retry_after_sec: retryAfterSec }, 429);
    }
    await next();
  };

  return Object.assign(mw, { store });
}
