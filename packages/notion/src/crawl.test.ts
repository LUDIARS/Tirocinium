import { describe, it, expect } from 'vitest';
import { crawlDatabase } from './crawl.js';
import type { NotionApi, NotionBlock, NotionPage, Paged } from './types.js';

const titleProp = (s: string) => ({ Name: { type: 'title', title: [{ plain_text: s }] } });
const paragraph = (id: string, s: string): NotionBlock =>
  ({ id, type: 'paragraph', paragraph: { rich_text: [{ plain_text: s }] } } as NotionBlock);

/** in-memory の fake Notion API。 */
class FakeNotion implements NotionApi {
  rows = new Map<string, NotionPage[]>();
  children = new Map<string, NotionBlock[]>();
  pages = new Map<string, NotionPage>();
  calls = { query: 0, children: 0, retrieve: 0 };

  async queryDatabase(databaseId: string): Promise<Paged<NotionPage>> {
    this.calls.query++;
    return { results: this.rows.get(databaseId) ?? [], next_cursor: null, has_more: false };
  }
  async getBlockChildren(blockId: string): Promise<Paged<NotionBlock>> {
    this.calls.children++;
    return { results: this.children.get(blockId) ?? [], next_cursor: null, has_more: false };
  }
  async retrievePage(pageId: string): Promise<NotionPage> {
    this.calls.retrieve++;
    const p = this.pages.get(pageId);
    if (!p) throw new Error(`page not found: ${pageId}`);
    return p;
  }
}

function fixture(): FakeNotion {
  const api = new FakeNotion();
  // db1 has rows p1, p2
  api.rows.set('db1', [
    { id: 'p1', url: 'https://n/p1', properties: titleProp('Page 1') },
    { id: 'p2', url: 'https://n/p2', properties: titleProp('Page 2') },
  ]);
  // p1 has a paragraph + a child_page sub1
  api.children.set('p1', [
    paragraph('b1', 'hello'),
    { id: 'sub1', type: 'child_page', child_page: { title: 'Sub 1' } } as NotionBlock,
  ]);
  api.children.set('p2', []);
  // sub1 page + its blocks
  api.pages.set('sub1', { id: 'sub1', url: 'https://n/sub1', properties: titleProp('Sub 1') });
  api.children.set('sub1', [paragraph('b2', 'nested content')]);
  return api;
}

describe('crawlDatabase', () => {
  it('crawls db rows + descends into child_page', async () => {
    const api = fixture();
    const res = await crawlDatabase(api, 'db1');
    const byId = Object.fromEntries(res.pages.map((p) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual(['p1', 'p2', 'sub1']);
    expect(byId['p1']!.kind).toBe('database_row');
    expect(byId['p1']!.title).toBe('Page 1');
    expect(byId['p1']!.markdown).toContain('hello');
    expect(byId['sub1']!.kind).toBe('child_page');
    expect(byId['sub1']!.depth).toBe(1);
    expect(byId['sub1']!.markdown).toContain('nested content');
    expect(res.errors).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it('respects maxDepth=0 (no descent)', async () => {
    const res = await crawlDatabase(fixture(), 'db1', { maxDepth: 0 });
    expect(res.pages.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('respects maxPages (truncation)', async () => {
    const res = await crawlDatabase(fixture(), 'db1', { maxPages: 1 });
    expect(res.pages).toHaveLength(1);
    expect(res.truncated).toBe(true);
  });

  it('records errors without aborting the whole crawl', async () => {
    const api = fixture();
    api.children.set('sub1', undefined as unknown as NotionBlock[]); // ok (empty)
    api.pages.delete('sub1'); // retrievePage will throw for sub1
    const res = await crawlDatabase(api, 'db1');
    expect(res.pages.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(res.errors.some((e) => e.id === 'sub1' && e.stage === 'retrievePage')).toBe(true);
  });

  it('dedupes already-visited pages (no infinite loop)', async () => {
    const api = fixture();
    // p2 links back to p1 as a child_page → must not re-crawl p1
    api.children.set('p2', [{ id: 'p1', type: 'child_page', child_page: { title: 'Page 1' } } as NotionBlock]);
    const res = await crawlDatabase(api, 'db1');
    expect(res.pages.filter((p) => p.id === 'p1')).toHaveLength(1);
  });
});
