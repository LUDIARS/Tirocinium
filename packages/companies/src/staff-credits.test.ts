import { describe, it, expect } from 'vitest';
import { parseStaffCredits, type StaffCredit } from './staff-credits.js';

const has = (credits: StaffCredit[], company: string, role: string): boolean =>
  credits.some((c) => c.company === company && c.role === role);

describe('parseStaffCredits', () => {
  it('groups companies by section header role (full credits incl. 外注/協力)', () => {
    const text = [
      'グランブルーファンタジー リリンク',
      'Developed by',
      '株式会社シグナルスタジオ',
      'Published by',
      'Cygames, Inc.',
      '開発協力',
      'グレンジ Inc.',
      '株式会社外注スタジオA',
    ].join('\n');
    const r = parseStaffCredits(text);
    expect(r.game).toBe('グランブルーファンタジー リリンク');
    expect(has(r.credits, '株式会社シグナルスタジオ', 'developer')).toBe(true);
    expect(has(r.credits, 'Cygames, Inc.', 'publisher')).toBe(true);
    // 開発協力 section の外注スタジオは support 役割で拾う。
    expect(has(r.credits, 'グレンジ Inc.', 'support')).toBe(true);
    expect(has(r.credits, '株式会社外注スタジオA', 'support')).toBe(true);
  });

  it('parses inline "Role: CompanyA, CompanyB" lines', () => {
    const r = parseStaffCredits('開発: 株式会社トーセ、有限会社サンプルソフト', { game: 'テストゲーム' });
    expect(r.game).toBe('テストゲーム');
    expect(has(r.credits, '株式会社トーセ', 'developer')).toBe(true);
    expect(has(r.credits, '有限会社サンプルソフト', 'developer')).toBe(true);
  });

  it('classifies 開発協力 as support, not developer', () => {
    const r = parseStaffCredits('開発協力: 株式会社ヘキサドライブ', { game: 'G' });
    expect(has(r.credits, '株式会社ヘキサドライブ', 'support')).toBe(true);
    expect(has(r.credits, '株式会社ヘキサドライブ', 'developer')).toBe(false);
  });

  it('excludes individual person names (no company indicator)', () => {
    const text = ['Directed by', '山田太郎', 'Music', '鈴木花子', 'Developed by', '株式会社ゲームスタジオ'].join('\n');
    const r = parseStaffCredits(text, { game: 'G' });
    expect(r.credits).toHaveLength(1);
    expect(has(r.credits, '株式会社ゲームスタジオ', 'developer')).toBe(true);
  });

  it('falls back to credited for company lines under no known section', () => {
    const r = parseStaffCredits('株式会社ノーセクション', { game: 'G' });
    expect(has(r.credits, '株式会社ノーセクション', 'credited')).toBe(true);
  });

  it('dedups identical company+role', () => {
    const r = parseStaffCredits('開発: 株式会社A\n開発元: 株式会社A', { game: 'G' });
    expect(r.credits.filter((c) => c.company === '株式会社A' && c.role === 'developer')).toHaveLength(1);
  });

  it('returns empty credits for text without companies', () => {
    expect(parseStaffCredits('（クレジットなし）', { game: 'G' }).credits).toEqual([]);
  });
});
