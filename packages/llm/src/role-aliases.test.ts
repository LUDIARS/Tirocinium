import { describe, expect, it } from 'vitest';
import { canonicalRole, expandTerms, splitKeywords } from './role-aliases.js';

describe('canonicalRole', () => {
  it('別名を canonical role に正規化する', () => {
    expect(canonicalRole('プログラマー')).toBe('programmer');
    expect(canonicalRole('クライアントエンジニア')).toBe('programmer');
    expect(canonicalRole('ゲームプランナー')).toBe('planner');
    expect(canonicalRole('企画')).toBe('planner');
    expect(canonicalRole('3D モデラー')).toBe('designer');
    expect(canonicalRole('サウンドクリエイター')).toBe('sound');
  });

  it('大文字小文字を区別しない', () => {
    expect(canonicalRole('Programmer')).toBe('programmer');
    expect(canonicalRole('ENGINEER')).toBe('programmer');
  });

  it('未知 / 空 / null は general', () => {
    expect(canonicalRole('宇宙飛行士')).toBe('general');
    expect(canonicalRole('')).toBe('general');
    expect(canonicalRole(null)).toBe('general');
    expect(canonicalRole(undefined)).toBe('general');
  });
});

describe('expandTerms', () => {
  it('技術略称を相互展開する (UE → Unreal Engine)', () => {
    const out = expandTerms(['UE']);
    expect(out).toContain('UE');
    expect(out.map((t) => t.toLowerCase())).toContain('unreal engine');
  });

  it('重複を除去し順序を保存する', () => {
    const out = expandTerms(['unity', 'ユニティ', 'unity']);
    const lower = out.map((t) => t.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    expect(out[0]).toBe('unity');
  });

  it('辞書に無い語はそのまま残す', () => {
    expect(expandTerms(['任天堂'])).toEqual(['任天堂']);
  });
});

describe('splitKeywords', () => {
  it('句読点・空白で分解し 1 文字語を落とす', () => {
    expect(splitKeywords('株式会社Example、ゲームプログラマ志望。C++ と Unity')).toEqual([
      '株式会社Example',
      'ゲームプログラマ志望',
      'C++',
      'Unity',
    ]);
  });
});
