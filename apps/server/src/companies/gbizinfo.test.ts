import { describe, it, expect } from 'vitest';
import { extractHojinList, discoverHojin, type GBizClient, type GBizPage } from './gbizinfo.js';
import type { GBizHojin } from '@tirocinium/companies';

describe('extractHojinList', () => {
  it('hojin-infos / hojinInfos / results / hojin の揺れを吸収する', () => {
    expect(extractHojinList({ 'hojin-infos': [{ name: 'A' }] })).toEqual([{ name: 'A' }]);
    expect(extractHojinList({ hojinInfos: [{ name: 'B' }] })).toEqual([{ name: 'B' }]);
    expect(extractHojinList({ results: [{ name: 'C' }] })).toEqual([{ name: 'C' }]);
  });
  it('配列でない / null は空配列', () => {
    expect(extractHojinList(null)).toEqual([]);
    expect(extractHojinList({ 'hojin-infos': 'x' })).toEqual([]);
  });
});

/** ページ配列を順に返す fake client。 */
function fakeClient(pages: GBizHojin[][]): GBizClient {
  return {
    async search(_query, page): Promise<GBizPage> {
      return { hojin: pages[page - 1] ?? [] };
    },
  };
}

describe('discoverHojin', () => {
  it('空ページに当たるまでページを走査して集約する', async () => {
    const client = fakeClient([
      [{ corporate_number: '1', name: 'A' }, { corporate_number: '2', name: 'B' }],
      [{ corporate_number: '3', name: 'C' }],
      [],
    ]);
    const out = await discoverHojin(client, { name: 'x' });
    expect(out.map((h) => h.corporate_number)).toEqual(['1', '2', '3']);
  });

  it('法人番号で dedup する (ページ跨ぎの重複を畳む)', async () => {
    const client = fakeClient([
      [{ corporate_number: '1', name: 'A' }],
      [{ corporate_number: '1', name: 'A(dup)' }, { corporate_number: '2', name: 'B' }],
      [],
    ]);
    const out = await discoverHojin(client, { name: 'x' });
    expect(out.map((h) => h.corporate_number)).toEqual(['1', '2']);
  });

  it('max で打ち切る', async () => {
    const client = fakeClient([
      [{ corporate_number: '1', name: 'A' }, { corporate_number: '2', name: 'B' }, { corporate_number: '3', name: 'C' }],
    ]);
    const out = await discoverHojin(client, { name: 'x' }, { max: 2 });
    expect(out).toHaveLength(2);
  });
});
