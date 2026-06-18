import { describe, it, expect } from 'vitest';
import { parseFeed } from './rss.js';

describe('parseFeed', () => {
  it('RSS 2.0 の item を title/link/pubDate/description/category で拾う', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>gamebiz</title>
      <item>
        <title><![CDATA[新作発表]]></title>
        <link>https://gamebiz.jp/news/100</link>
        <description>本文 &amp; 続き</description>
        <pubDate>Thu, 18 Jun 2026 09:00:00 +0900</pubDate>
        <category>採用</category>
      </item>
      <item>
        <title>2件目</title>
        <link>https://gamebiz.jp/news/101</link>
      </item>
    </channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe('新作発表');
    expect(items[0]!.link).toBe('https://gamebiz.jp/news/100');
    expect(items[0]!.description).toBe('本文 & 続き');
    expect(items[0]!.categories).toEqual(['採用']);
    expect(items[0]!.publishedAt).toMatch(/^2026-06-18T/);
  });

  it('RSS 1.0 (RDF) の dc:date / dc:subject を拾う', () => {
    const xml = `<rdf:RDF xmlns:rdf="..." xmlns:dc="...">
      <item rdf:about="https://www.gamebusiness.jp/article/1.html">
        <title>採用記事</title>
        <link>https://www.gamebusiness.jp/article/1.html</link>
        <dc:date>2026-06-17T11:45:03Z</dc:date>
        <dc:subject>求人</dc:subject>
      </item>
    </rdf:RDF>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.link).toBe('https://www.gamebusiness.jp/article/1.html');
    expect(items[0]!.publishedAt).toBe('2026-06-17T11:45:03.000Z');
    expect(items[0]!.categories).toContain('求人');
  });

  it('Atom の entry / link href / published を拾う', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom求人</title>
        <link rel="alternate" href="https://example.com/a"/>
        <link rel="edit" href="https://example.com/edit"/>
        <summary>要約</summary>
        <published>2026-06-15T00:00:00Z</published>
        <category term="採用"/>
      </entry>
    </feed>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0]!.link).toBe('https://example.com/a');
    expect(items[0]!.description).toBe('要約');
    expect(items[0]!.categories).toContain('採用');
  });

  it('link が無い item は捨てる / 空入力は空配列', () => {
    expect(parseFeed('')).toEqual([]);
    const xml = `<rss><channel><item><title>リンク無し</title></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([]);
  });
});
