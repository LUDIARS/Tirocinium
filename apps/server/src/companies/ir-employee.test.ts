import { describe, it, expect } from 'vitest';
import { extractEmployeeForCompany, type UrlFetcher, type IrEmployeeSummary } from './ir-employee-extract.js';
import type { FetchResult } from './fetcher.js';

function fakeFetcher(pages: Record<string, string>): UrlFetcher {
  return {
    async fetch(url: string): Promise<FetchResult> {
      const html = pages[url];
      if (html === undefined) return { ok: false, reason: 'http', message: 'HTTP 404' };
      return { ok: true, html };
    },
  };
}

const summary = (): IrEmployeeSummary => ({
  targets: 0, resolved: 0, unresolved: 0, pagesFetched: 0, robotsBlocked: 0, errors: [],
});

describe('extractEmployeeForCompany', () => {
  it('follows IR/about links and prefers consolidated employee count', async () => {
    const fetcher = fakeFetcher({
      'https://example.co.jp/': '<html><body><a href="/ir/">IR情報</a><a href="/company/">会社概要</a></body></html>',
      'https://example.co.jp/ir/': '<html><body><p>従業員数 連結12,345名 単体3,400名（2026年3月末）</p></body></html>',
      'https://example.co.jp/company/': '<html><body><p>設立 2000年</p></body></html>',
    });
    const s = summary();
    const r = await extractEmployeeForCompany(fetcher, { name: 'X社', url: 'https://example.co.jp/' }, s, 5);
    expect(r.employeeCount).toBe(12345);
    expect(s.pagesFetched).toBe(3);
    expect(r.fetchedUrls).toContain('https://example.co.jp/ir/');
  });

  it('extracts from the 会社概要 page when home has no figure', async () => {
    const fetcher = fakeFetcher({
      'https://x.jp/': '<html><body><a href="/about">会社概要</a></body></html>',
      'https://x.jp/about': '<html><body>従業員数 540名（2026年3月期）</body></html>',
    });
    const s = summary();
    const r = await extractEmployeeForCompany(fetcher, { name: 'Y社', url: 'https://x.jp/' }, s, 5);
    expect(r.employeeCount).toBe(540);
  });

  it('returns 0 when no employee figure is present (capital noise ignored)', async () => {
    const fetcher = fakeFetcher({ 'https://z.jp/': '<html><body>資本金1億円。売上高45億円。</body></html>' });
    const s = summary();
    const r = await extractEmployeeForCompany(fetcher, { name: 'Z社', url: 'https://z.jp/' }, s, 5);
    expect(r.employeeCount).toBe(0);
    expect(s.pagesFetched).toBe(1);
  });

  it('skips companies without a url', async () => {
    const s = summary();
    const r = await extractEmployeeForCompany(fakeFetcher({}), { name: 'N社', url: '' }, s, 5);
    expect(r.employeeCount).toBe(0);
    expect(s.pagesFetched).toBe(0);
  });

  it('records robots-blocked home as a skip', async () => {
    const fetcher: UrlFetcher = { async fetch() { return { ok: false, reason: 'robots', message: 'blocked' }; } };
    const s = summary();
    const r = await extractEmployeeForCompany(fetcher, { name: 'R社', url: 'https://r.jp/' }, s, 5);
    expect(r.employeeCount).toBe(0);
    expect(s.robotsBlocked).toBe(1);
    expect(s.pagesFetched).toBe(0);
  });
});
