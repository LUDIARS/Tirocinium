import { describe, it, expect } from 'vitest';
import { parseNewsSources, selectActiveNewsSources, type NewsSourceConfig } from './news-config.js';

describe('parseNewsSources', () => {
  it('rss / job-listing / recruit-page の 3 kind を受理する', () => {
    const out = parseNewsSources([
      { id: 'a', kind: 'rss', urls: ['https://x/feed'] },
      { id: 'b', kind: 'job-listing', urls: ['https://x/jobs'] },
      { id: 'c', kind: 'recruit-page', urls: ['https://x/career'], company: '株式会社X' },
    ]);
    expect(out.map((s) => s.kind)).toEqual(['rss', 'job-listing', 'recruit-page']);
  });

  it('recruit-page の company を取り込む (前後空白は trim)', () => {
    const [s] = parseNewsSources([
      { id: 'melpot', kind: 'recruit-page', urls: ['https://melpot.com/career/'], company: '  株式会社MELPOT  ' },
    ]);
    expect(s!.company).toBe('株式会社MELPOT');
  });

  it('newgradOnly 既定は kind 依存 (recruit-page=false / job-listing=true / rss=true)', () => {
    const out = parseNewsSources([
      { id: 'r', kind: 'recruit-page', urls: ['https://x/c'] },
      { id: 'j', kind: 'job-listing', urls: ['https://x/j'] },
      { id: 's', kind: 'rss', urls: ['https://x/f'] },
    ]);
    expect(out.map((s) => s.newgradOnly)).toEqual([false, true, true]);
  });

  it('newgradOnly は明示値があれば既定より優先', () => {
    const [r, j] = parseNewsSources([
      { id: 'r', kind: 'recruit-page', urls: ['https://x/c'], newgradOnly: true },
      { id: 'j', kind: 'job-listing', urls: ['https://x/j'], newgradOnly: false },
    ]);
    expect(r!.newgradOnly).toBe(true);
    expect(j!.newgradOnly).toBe(false);
  });

  it('未知 kind は rss に倒す / company 空は undefined', () => {
    const [s] = parseNewsSources([{ id: 'x', kind: 'bogus', urls: ['https://x/1'], company: '   ' }]);
    expect(s!.kind).toBe('rss');
    expect(s!.company).toBeUndefined();
  });

  it('id 無し / urls 空は捨てる', () => {
    const out = parseNewsSources([
      { kind: 'rss', urls: ['https://x/1'] },
      { id: 'y', kind: 'rss', urls: [] },
      { id: 'z', kind: 'rss', urls: ['https://x/2'] },
    ]);
    expect(out.map((s) => s.id)).toEqual(['z']);
  });

  it('配列以外は空配列', () => {
    expect(parseNewsSources(null)).toEqual([]);
    expect(parseNewsSources({})).toEqual([]);
  });
});

describe('selectActiveNewsSources', () => {
  const sources: NewsSourceConfig[] = [
    { id: 'on', kind: 'recruit-page', urls: ['https://a'], hiringOnly: true, enabled: true },
    { id: 'off', kind: 'recruit-page', urls: ['https://b'], hiringOnly: true, enabled: false },
  ];

  it('enabled=true のみ起動 (env opt-in 無し)', () => {
    expect(selectActiveNewsSources(sources).map((s) => s.id)).toEqual(['on']);
  });

  it('sourceId 指定でその 1 件に絞る (enabled なら)', () => {
    expect(selectActiveNewsSources(sources, 'on').map((s) => s.id)).toEqual(['on']);
    expect(selectActiveNewsSources(sources, 'off')).toEqual([]); // disabled は弾く
  });
});
