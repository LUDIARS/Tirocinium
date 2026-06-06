import { describe, it, expect } from 'vitest';
import { extractAnchors, selectEnrichmentLinks, enrichmentFetchList } from './links.js';

const HTML = `
<a href="/company/philosophy">企業理念</a>
<a href="/ir/library">IR情報</a>
<a href="/about">会社概要</a>
<a href="/recruit/newgrad">新卒採用</a>
<a href="https://other.example.com/x">外部リンク</a>
<a href="/news">お知らせ</a>
`;

describe('extractAnchors', () => {
  it('extracts href + cleaned text', () => {
    const a = extractAnchors('<a href="/x">  <b>理念</b> </a>');
    expect(a[0]).toEqual({ href: '/x', text: '理念' });
  });
});

describe('selectEnrichmentLinks', () => {
  const links = selectEnrichmentLinks('https://corp.example.com/', HTML);

  it('categorizes same-host links by vocabulary', () => {
    expect(links.philosophy).toContain('https://corp.example.com/company/philosophy');
    expect(links.ir).toContain('https://corp.example.com/ir/library');
    expect(links.about).toContain('https://corp.example.com/about');
    expect(links.recruit).toContain('https://corp.example.com/recruit/newgrad');
  });

  it('excludes external-host links', () => {
    const all = [...links.ir, ...links.philosophy, ...links.about, ...links.recruit];
    expect(all.every((u) => u.startsWith('https://corp.example.com/'))).toBe(true);
  });
});

describe('enrichmentFetchList', () => {
  it('orders philosophy > ir > about > recruit and dedupes', () => {
    const out = enrichmentFetchList({
      philosophy: ['https://c/p'],
      ir: ['https://c/ir'],
      about: ['https://c/p'], // dup of philosophy
      recruit: ['https://c/r'],
    });
    expect(out).toEqual(['https://c/p', 'https://c/ir', 'https://c/r']);
  });
});
