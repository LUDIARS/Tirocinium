import { describe, it, expect } from 'vitest';
import { runWikidataUrlFill, type WikidataUrlDeps, type WikidataUrlTarget } from './wikidata-url.js';

function deps(
  targets: WikidataUrlTarget[],
  sites: Record<string, string>,
  applied: Record<string, string> = {},
): WikidataUrlDeps {
  return {
    async loadTargets(limit) {
      return targets.slice(0, limit);
    },
    async resolveSite(label) {
      return sites[label] ?? '';
    },
    async applyUrl(id, url) {
      applied[id] = url;
      return true;
    },
  };
}

describe('runWikidataUrlFill', () => {
  it('fills url for companies whose official site resolves', async () => {
    const applied: Record<string, string> = {};
    // resolveSite は生の社名を受ける (クリーニングは実 fetchOfficialSite 内で行う契約)。
    const d = deps(
      [{ id: 'a', name: '株式会社カプコン' }, { id: 'b', name: 'グリー株式会社' }],
      { '株式会社カプコン': 'https://www.capcom.co.jp/', 'グリー株式会社': 'https://corp.gree.net/' },
      applied,
    );
    const s = await runWikidataUrlFill(d, { minIntervalMs: 0 });
    expect(s.targets).toBe(2);
    expect(s.filled).toBe(2);
    expect(s.notFound).toBe(0);
    expect(applied['a']).toBe('https://www.capcom.co.jp/');
    expect(applied['b']).toBe('https://corp.gree.net/');
  });

  it('counts unresolved companies as notFound (no DB write)', async () => {
    const applied: Record<string, string> = {};
    const d = deps([{ id: 'x', name: '無名スタジオ' }], {}, applied);
    const s = await runWikidataUrlFill(d, { minIntervalMs: 0 });
    expect(s.filled).toBe(0);
    expect(s.notFound).toBe(1);
    expect(applied['x']).toBeUndefined();
  });

  it('isolates a resolver error to one company and keeps going', async () => {
    const d: WikidataUrlDeps = {
      async loadTargets() {
        return [{ id: 'e', name: 'エラー社' }, { id: 'ok', name: 'カプコン' }];
      },
      async resolveSite(label) {
        if (label === 'エラー社') throw new Error('wikidata HTTP 429');
        return 'https://www.capcom.co.jp/';
      },
      async applyUrl() {
        return true;
      },
    };
    const s = await runWikidataUrlFill(d, { minIntervalMs: 0 });
    expect(s.filled).toBe(1);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]!.company).toBe('エラー社');
  });

  it('respects the limit passed to loadTargets', async () => {
    let askedLimit = -1;
    const d: WikidataUrlDeps = {
      async loadTargets(limit) {
        askedLimit = limit;
        return [];
      },
      async resolveSite() {
        return '';
      },
      async applyUrl() {
        return true;
      },
    };
    await runWikidataUrlFill(d, { limit: 7, minIntervalMs: 0 });
    expect(askedLimit).toBe(7);
  });
});
