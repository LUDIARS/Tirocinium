// robots.txt 遵守 + per-domain レート制限つきの礼節 fetcher。
// listing クロールと enrichment 巡回の共通取得層。 純粋ロジック (parse/allow) は
// @tirocinium/companies の robots.ts に委譲し、 ここは fetch / cache / 待機を持つ。

import { parseRobots, isAllowed, pathOf, type RobotsRules } from '@tirocinium/companies';
import { safeFetch } from './ssrf-guard.js';

/** Bound caller latency even while the platform DNS resolver cannot be cancelled. */
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export type FetcherConfig = {
  /** Optional bounded response for interactive research, including robots.txt. */
  maxResponseBytes?: number;
  userAgent: string;
  fetchTimeoutMs: number;
  /** 同一ドメインへの最小間隔 (ms)。 robots の Crawl-delay があれば長い方を採用 */
  minIntervalMs: number;
  /** robots.txt を尊重するか (既定 true)。 false でも礼節 UA / レート制限は維持 */
  respectRobots: boolean;
};

export type FetchResult =
  | { ok: true; html: string; finalUrl?: string }
  | { ok: false; reason: 'robots' | 'http' | 'timeout' | 'error'; message: string };

export class PoliteFetcher {
  private robots = new Map<string, RobotsRules | null>();
  private lastAt = new Map<string, number>();

  constructor(private readonly cfg: FetcherConfig) {}

  /** robots を考慮して取得。 取得不可は理由つきで返す (例外を投げない)。 */
  async fetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return { ok: false, reason: 'error', message: 'invalid url' };
    }

    if (this.cfg.respectRobots) {
      const rules = await this.robotsFor(url, host, signal);
      if (rules && !isAllowed(rules, pathOf(url))) {
        return { ok: false, reason: 'robots', message: 'disallowed by robots.txt' };
      }
      await this.throttle(host, rules?.crawlDelay, signal);
    } else {
      await this.throttle(host, undefined, signal);
    }

    if (signal?.aborted) return { ok: false, reason: 'timeout', message: 'research_deadline' };
    return this.rawFetch(url, signal);
  }

  private async robotsFor(url: string, host: string, signal?: AbortSignal): Promise<RobotsRules | null> {
    if (this.robots.has(host)) return this.robots.get(host)!;
    let rules: RobotsRules | null = null;
    try {
      const origin = new URL(url).origin;
      const res = await this.rawFetch(origin + '/robots.txt', signal);
      if (res.ok) rules = parseRobots(res.html, this.cfg.userAgent);
    } catch {
      rules = null; // robots 取得失敗時は許可扱い (慣習)
    }
    this.robots.set(host, rules);
    return rules;
  }

  /** 同一ドメインへの連続アクセスを最小間隔まで待つ。 */
  private async throttle(host: string, crawlDelaySec?: number, signal?: AbortSignal): Promise<void> {
    const interval = Math.max(this.cfg.minIntervalMs, (crawlDelaySec ?? 0) * 1000);
    const last = this.lastAt.get(host) ?? 0;
    const wait = last + interval - Date.now();
    if (wait > 0 && !signal?.aborted) await new Promise<void>((resolve) => {
      const finish = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, wait);
      signal?.addEventListener('abort', finish, { once: true });
      if (signal?.aborted) finish();
    });
    this.lastAt.set(host, Date.now());
  }

  private async rawFetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.fetchTimeoutMs);
    const combined = signal ? AbortSignal.any([ctrl.signal, signal]) : ctrl.signal;
    try {
      const res = await abortable(safeFetch(url, {
        headers: { 'user-agent': this.cfg.userAgent, accept: 'text/html,*/*' },
        signal: combined,
      }), combined);
      if (!res.ok) return { ok: false, reason: 'http', message: `HTTP ${res.status}` };
      let html: string;
      if (this.cfg.maxResponseBytes && res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            const part = await abortable(reader.read(), combined); if (part.done) break;
            size += part.value.byteLength;
            if (size > this.cfg.maxResponseBytes) {
              await reader.cancel();
              return { ok: false, reason: 'error', message: 'response_too_large' };
            }
            chunks.push(part.value);
          }
          html = Buffer.concat(chunks).toString('utf8');
        } finally { reader.releaseLock(); }
      } else html = await res.text();
      return { ok: true, html, finalUrl: res.url || url };
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === 'AbortError') return { ok: false, reason: 'timeout', message: 'timeout' };
      return { ok: false, reason: 'error', message: e.message ?? 'fetch error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
