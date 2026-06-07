// Notion 公式 REST API クライアント (raw fetch、 依存ゼロ)。
// 指定トークンで databases.query / blocks.children / pages.retrieve を叩く。
// Notion のレート制限 (~3 req/s) に合わせた最小間隔 + 429/5xx リトライ。

import type { NotionApi, NotionBlock, NotionPage, Paged } from './types.js';

export type NotionClientConfig = {
  /** Notion integration token (secret_xxx / ntn_xxx) */
  token: string;
  /** Notion-Version ヘッダ。 既定 2022-06-28 */
  notionVersion?: string;
  baseUrl?: string;
  /** API 呼び出しの最小間隔 ms (既定 350 ≒ 3 req/s) */
  minIntervalMs?: number;
  /** 429/5xx の最大リトライ回数 (既定 4) */
  maxRetries?: number;
};

export class NotionApiClient implements NotionApi {
  private readonly token: string;
  private readonly version: string;
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private lastAt = 0;

  constructor(cfg: NotionClientConfig) {
    if (!cfg.token) throw new Error('Notion token is required');
    this.token = cfg.token;
    this.version = cfg.notionVersion ?? '2022-06-28';
    this.baseUrl = (cfg.baseUrl ?? 'https://api.notion.com/v1').replace(/\/$/, '');
    this.minIntervalMs = cfg.minIntervalMs ?? 350;
    this.maxRetries = cfg.maxRetries ?? 4;
  }

  async queryDatabase(databaseId: string, cursor?: string): Promise<Paged<NotionPage>> {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body['start_cursor'] = cursor;
    const json = await this.request('POST', `/databases/${databaseId}/query`, body);
    return this.toPaged<NotionPage>(json);
  }

  async getBlockChildren(blockId: string, cursor?: string): Promise<Paged<NotionBlock>> {
    const qs = new URLSearchParams({ page_size: '100' });
    if (cursor) qs.set('start_cursor', cursor);
    const json = await this.request('GET', `/blocks/${blockId}/children?${qs.toString()}`);
    return this.toPaged<NotionBlock>(json);
  }

  async retrievePage(pageId: string): Promise<NotionPage> {
    return (await this.request('GET', `/pages/${pageId}`)) as NotionPage;
  }

  private toPaged<T>(json: unknown): Paged<T> {
    const o = (json ?? {}) as { results?: T[]; next_cursor?: string | null; has_more?: boolean };
    return {
      results: Array.isArray(o.results) ? o.results : [],
      next_cursor: o.next_cursor ?? null,
      has_more: o.has_more ?? false,
    };
  }

  private async throttle(): Promise<void> {
    const wait = this.lastAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      await this.throttle();
      const res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'notion-version': this.version,
          'content-type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return res.json();

      // 429 / 5xx はリトライ
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** attempt, 10_000);
        attempt++;
        await sleep(backoff);
        continue;
      }
      const text = await res.text().catch(() => '');
      throw new Error(`notion ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** env から client を作る (NOTION_TOKEN)。 無ければ null。 */
export function createNotionClient(env: NodeJS.ProcessEnv = process.env): NotionApiClient | null {
  const token = env['NOTION_TOKEN'];
  if (!token) return null;
  return new NotionApiClient({
    token,
    notionVersion: env['NOTION_VERSION'],
    minIntervalMs: env['NOTION_MIN_INTERVAL_MS'] ? Number(env['NOTION_MIN_INTERVAL_MS']) : undefined,
  });
}
