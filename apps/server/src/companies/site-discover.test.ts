import { describe, it, expect } from 'vitest';
import { parseSitemapLocs, categorizeUrls } from './site-discover.js';

describe('parseSitemapLocs', () => {
  it('<loc> の http(s) URL を抽出する', () => {
    const xml = `<urlset><url><loc>https://x.test/works/a/</loc></url>
      <url><loc> https://x.test/career/ </loc></url><url><loc>ftp://no</loc></url></urlset>`;
    expect(parseSitemapLocs(xml)).toEqual(['https://x.test/works/a/', 'https://x.test/career/']);
  });
});

describe('categorizeUrls', () => {
  const urls = [
    'https://x.test/',
    'https://x.test/works/',
    'https://x.test/works/game-a/',
    'https://x.test/works/game-b/',
    'https://x.test/career/',
    'https://x.test/career/engineer/',
    'https://x.test/company/',
    'https://x.test/news/2026/',
  ];

  it('works/career/about に分類する', () => {
    const r = categorizeUrls(urls);
    expect(r.worksUrls).toContain('https://x.test/works/game-a/');
    expect(r.careerUrls).toContain('https://x.test/career/');
    expect(r.aboutUrls).toContain('https://x.test/company/');
    // news は どのカテゴリにも入らない
    expect([...r.worksUrls, ...r.careerUrls, ...r.aboutUrls]).not.toContain('https://x.test/news/2026/');
  });

  it('works は個別ページ (slug 付き) を一覧 (/works/) より優先する', () => {
    const r = categorizeUrls(urls, { works: 2 });
    // 上限2 でも 一覧ではなく個別ページが残る
    expect(r.worksUrls).not.toContain('https://x.test/works/');
    expect(r.worksUrls.every((u) => /\/works\/[^/]+\/$/.test(u))).toBe(true);
  });

  it('上限を超えたら切り詰める', () => {
    const r = categorizeUrls(urls, { works: 1, career: 1, about: 1 });
    expect(r.worksUrls.length).toBe(1);
    expect(r.careerUrls.length).toBe(1);
    expect(r.aboutUrls.length).toBe(1);
  });
});
