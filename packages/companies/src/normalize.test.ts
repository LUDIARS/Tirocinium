import { describe, it, expect } from 'vitest';
import { normalizeName, normalizeRoles, normalizeCompany, dedupeCompanies } from './normalize.js';
import type { NormalizedCompany } from './types.js';

describe('normalizeName', () => {
  it('strips legal suffixes / symbols / case for dedup', () => {
    expect(normalizeName('株式会社ABCゲームズ')).toBe('abcゲームズ');
    expect(normalizeName('ABC Games Co., Ltd.')).toBe('abcgames');
    expect(normalizeName('（株）テスト')).toBe('テスト');
  });

  it('treats legal-variant names as the same key', () => {
    expect(normalizeName('株式会社テスト')).toBe(normalizeName('テスト株式会社'));
  });

  it('strips parenthetical annotations so seed↔research names join', () => {
    expect(normalizeName('グリー株式会社（グリーホールディングス株式会社）')).toBe(normalizeName('グリー株式会社'));
    expect(normalizeName('株式会社ディー・エヌ・エー（DeNA）')).toBe(normalizeName('株式会社ディー・エヌ・エー'));
    expect(normalizeName('株式会社ビサイド (BeXide Inc.)')).toBe(normalizeName('株式会社ビサイド'));
  });
});

describe('normalizeRoles', () => {
  it('maps aliases (ja/en) to canonical role lenses', () => {
    expect(normalizeRoles(['エンジニア', 'デザイナー'])).toEqual(['programmer', 'designer']);
    expect(normalizeRoles(['企画', 'サウンド'])).toEqual(['planner', 'sound']);
  });

  it('drops unknown roles and "any", dedupes', () => {
    expect(normalizeRoles(['programmer', 'Programmer', 'any', 'marketing'])).toEqual(['programmer']);
  });

  it('handles undefined', () => {
    expect(normalizeRoles(undefined)).toEqual([]);
  });
});

describe('normalizeCompany', () => {
  it('returns null when name is empty', () => {
    expect(normalizeCompany({ name: '' })).toBeNull();
    expect(normalizeCompany({ name: '   ' })).toBeNull();
  });

  it('fills defaults and falls back source_url to url', () => {
    const c = normalizeCompany({
      name: '株式会社テスト',
      url: 'https://example.com',
      roles: ['エンジニア'],
      tags: ['Unity', 'unity', 'C#'],
    });
    expect(c?.normalized_name).toBe('テスト');
    expect(c?.roles).toEqual(['programmer']);
    expect(c?.tags).toEqual(['Unity', 'C#']); // case-insensitive dedup keeps first
    expect(c?.source).toBe('unknown');
    expect(c?.source_url).toBe('https://example.com');
  });
});

describe('dedupeCompanies', () => {
  it('keeps the last record per normalized_name', () => {
    const mk = (name: string, desc: string): NormalizedCompany => ({
      name,
      normalized_name: 'テスト',
      url: '',
      industry: '',
      description: desc,
      roles: [],
      tags: [],
      location: '',
      size: '',
      employee_count: 0,
      listing_market: '',
      source: 's',
      source_url: '',
    });
    const out = dedupeCompanies([mk('テスト', 'old'), mk('株式会社テスト', 'new')]);
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe('new');
  });
});
