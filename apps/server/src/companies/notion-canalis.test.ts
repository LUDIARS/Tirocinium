import { describe, it, expect, vi } from 'vitest';
import { notionRecordToCompany } from './notion-canalis.js';
import type { RawRecord } from '@ludiars/canalis';

// repo.ts は DB 接続を初期化するため、DB 不要な純粋関数テストではモックに差し替える。
vi.mock('./repo.js', () => ({}));

function record(props: Record<string, string>, over: Partial<RawRecord> = {}): RawRecord {
  return {
    source: 'notion',
    sourceId: 'page-1',
    fetchedAt: '2026-06-09T00:00:00.000Z',
    title: 'Acme Inc',
    url: 'https://notion.so/page-1',
    raw: {},
    meta: { properties: props },
    ...over,
  };
}

describe('notionRecordToCompany', () => {
  it('Notion プロパティを CompanyInput に決定論マッピングする', () => {
    const c = notionRecordToCompany(
      record({ 業界: 'ゲーム', 職種: 'planner、programmer', タグ: 'Unity, C#', 所在地: '東京' }),
    );
    expect(c).toMatchObject({
      name: 'Acme Inc',
      industry: 'ゲーム',
      roles: ['planner', 'programmer'],
      tags: ['Unity', 'C#'],
      location: '東京',
      source: 'notion',
      source_url: 'https://notion.so/page-1',
    });
  });

  it('title が無ければ name 候補キーで補完', () => {
    const c = notionRecordToCompany(record({ 会社名: 'フォールバック社' }, { title: '' }));
    expect(c?.name).toBe('フォールバック社');
  });

  it('社名が一切取れない行は null', () => {
    expect(notionRecordToCompany(record({}, { title: '' }))).toBeNull();
  });

  it('fieldMap で候補キーを上書きできる', () => {
    const c = notionRecordToCompany(record({ Sector: 'IT' }), { industry: ['Sector'] });
    expect(c?.industry).toBe('IT');
  });
});
