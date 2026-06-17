import { describe, it, expect } from 'vitest';
import { selectSurvivor, mergeCompanyFields, type MergeCandidate } from './company-merge.js';
import type { Company } from './types.js';

// ── selectSurvivor ─────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<MergeCandidate> & { id: string }): MergeCandidate {
  return {
    url: '',
    description: '',
    crawled_at: '2024-01-01T00:00:00.000Z',
    gameCount: 0,
    obCount: 0,
    ...overrides,
  };
}

describe('selectSurvivor', () => {
  it('スコアが最高の候補を survivor に選ぶ', () => {
    const group: MergeCandidate[] = [
      makeCandidate({ id: 'a', url: '', description: '', gameCount: 0 }),
      makeCandidate({ id: 'b', url: 'https://capcom.com', description: '大手', gameCount: 5 }),
      makeCandidate({ id: 'c', url: 'https://x.com', description: '', gameCount: 1 }),
    ];
    expect(selectSurvivor(group)).toBe('b'); // score: a=0, b=7, c=2
  });

  it('同点の場合は crawled_at が古い方 (昇順) を選ぶ', () => {
    const group: MergeCandidate[] = [
      makeCandidate({ id: 'newer', crawled_at: '2024-06-01T00:00:00.000Z', url: 'https://x.com' }),
      makeCandidate({ id: 'older', crawled_at: '2023-01-01T00:00:00.000Z', url: 'https://x.com' }),
    ];
    expect(selectSurvivor(group)).toBe('older');
  });

  it('crawled_at も同点ならば id 昇順', () => {
    const ts = '2024-01-01T00:00:00.000Z';
    const group: MergeCandidate[] = [
      makeCandidate({ id: 'z-id', crawled_at: ts }),
      makeCandidate({ id: 'a-id', crawled_at: ts }),
    ];
    expect(selectSurvivor(group)).toBe('a-id');
  });

  it('1 件グループは自身を返す', () => {
    const group = [makeCandidate({ id: 'solo' })];
    expect(selectSurvivor(group)).toBe('solo');
  });

  it('obCount も加点される', () => {
    const group: MergeCandidate[] = [
      makeCandidate({ id: 'a', obCount: 10 }),
      makeCandidate({ id: 'b', obCount: 0 }),
    ];
    expect(selectSurvivor(group)).toBe('a');
  });
});

// ── mergeCompanyFields ────────────────────────────────────────────────────

function makeCompany(overrides: Partial<Company> & { id: string }): Company {
  return {
    name: 'テスト株式会社',
    normalized_name: 'テスト',
    url: '',
    industry: '',
    description: '',
    roles: [],
    tags: [],
    location: '',
    size: '',
    employee_count: 0,
    listing_market: '',
    source: '',
    source_url: '',
    is_newgrad: false,
    is_game: false,
    has_opening: false,
    recruit_url: '',
    stock_reason: '',
    sources: [],
    is_smb: false,
    is_listed: false,
    corporate_number: '',
    crawled_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeCompanyFields', () => {
  it('sources を全行で union する', () => {
    const survivor = makeCompany({
      id: 's',
      sources: [{ source: 'wikidata', url: 'https://wd' }],
      source: 'manual',
      source_url: '',
    });
    const loser = makeCompany({
      id: 'l',
      sources: [{ source: 'gbiz', url: 'https://gbiz' }],
      source: 'listing',
      source_url: 'https://listing',
    });
    const patch = mergeCompanyFields(survivor, [loser]);
    const sourceTags = patch.sources.map((s) => s.source);
    expect(sourceTags).toContain('wikidata');
    expect(sourceTags).toContain('manual');
    expect(sourceTags).toContain('gbiz');
    expect(sourceTags).toContain('listing');
  });

  it('boolean フラグは OR で集約する', () => {
    const survivor = makeCompany({ id: 's', is_newgrad: false, is_game: true, has_opening: false });
    const loser1 = makeCompany({ id: 'l1', is_newgrad: true, is_game: false, has_opening: false });
    const loser2 = makeCompany({ id: 'l2', is_newgrad: false, is_game: false, has_opening: true });
    const patch = mergeCompanyFields(survivor, [loser1, loser2]);
    expect(patch.is_newgrad).toBe(true);
    expect(patch.is_game).toBe(true);
    expect(patch.has_opening).toBe(true);
  });

  it('scalar は survivor が非空なら survivor を維持', () => {
    const survivor = makeCompany({ id: 's', url: 'https://capcom.com', industry: 'ゲーム' });
    const loser = makeCompany({ id: 'l', url: 'https://other.com', industry: '別の業界' });
    const patch = mergeCompanyFields(survivor, [loser]);
    expect(patch.url).toBe('https://capcom.com');
    expect(patch.industry).toBe('ゲーム');
  });

  it('scalar は survivor が空なら loser の非空値で補完する (COALESCE)', () => {
    const survivor = makeCompany({ id: 's', url: '', description: '' });
    const loser = makeCompany({ id: 'l', url: 'https://capcom.com', description: '大手ゲーム企業' });
    const patch = mergeCompanyFields(survivor, [loser]);
    expect(patch.url).toBe('https://capcom.com');
    expect(patch.description).toBe('大手ゲーム企業');
  });

  it('loser なし (1 件グループ) でも計算できる', () => {
    const survivor = makeCompany({
      id: 's',
      sources: [{ source: 'manual', url: '' }],
      is_newgrad: true,
      url: 'https://x.com',
    });
    const patch = mergeCompanyFields(survivor, []);
    expect(patch.is_newgrad).toBe(true);
    expect(patch.url).toBe('https://x.com');
  });

  it('sources の重複は dedup される', () => {
    const src = { source: 'wikidata', url: 'https://wd' };
    const survivor = makeCompany({ id: 's', sources: [src] });
    const loser = makeCompany({ id: 'l', sources: [src] });
    const patch = mergeCompanyFields(survivor, [loser]);
    const wd = patch.sources.filter((s) => s.source === 'wikidata');
    expect(wd).toHaveLength(1);
  });
});
