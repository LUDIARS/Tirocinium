import { describe, it, expect } from 'vitest';
import {
  classifyFromText,
  classifyListingEntry,
  shouldStock,
  stockReason,
} from './classify.js';

describe('classifyFromText', () => {
  it('detects newgrad / game / opening from JP keywords', () => {
    const f = classifyFromText('新卒採用2026年卒 ゲーム開発エンジニア募集中');
    expect(f).toEqual({ isNewgrad: true, isGame: true, hasOpening: true });
  });

  it('detects "26卒" style', () => {
    expect(classifyFromText('26卒 エントリー受付中').isNewgrad).toBe(true);
  });

  it('returns all false for unrelated text', () => {
    expect(classifyFromText('当社の製品一覧')).toEqual({
      isNewgrad: false,
      isGame: false,
      hasOpening: false,
    });
  });

  it('merges LLM hint (true wins)', () => {
    const f = classifyFromText('株式会社テスト', { isGame: true, hasOpening: true });
    expect(f.isGame).toBe(true);
    expect(f.hasOpening).toBe(true);
    expect(f.isNewgrad).toBe(false);
  });
});

describe('classifyListingEntry', () => {
  it('uses name + industry + snippet', () => {
    const f = classifyListingEntry({
      name: 'スタジオX',
      industry: 'ゲーム',
      snippet: 'キャリア採用',
    });
    expect(f.isGame).toBe(true);
    expect(f.hasOpening).toBe(true);
  });
});

describe('shouldStock', () => {
  it('stocks when newgrad', () => {
    expect(shouldStock({ isNewgrad: true, isGame: false, hasOpening: false })).toBe(true);
  });
  it('stocks game + opening even without newgrad', () => {
    expect(shouldStock({ isNewgrad: false, isGame: true, hasOpening: true })).toBe(true);
  });
  it('does NOT stock game without opening', () => {
    expect(shouldStock({ isNewgrad: false, isGame: true, hasOpening: false })).toBe(false);
  });
  it('does NOT stock non-game opening without newgrad', () => {
    expect(shouldStock({ isNewgrad: false, isGame: false, hasOpening: true })).toBe(false);
  });
});

describe('stockReason', () => {
  it('describes the reason', () => {
    expect(stockReason({ isNewgrad: true, isGame: true, hasOpening: true })).toBe('新卒採用 + ゲーム企業');
    expect(stockReason({ isNewgrad: true, isGame: false, hasOpening: false })).toBe('新卒採用あり');
    expect(stockReason({ isNewgrad: false, isGame: true, hasOpening: true })).toBe('ゲーム企業 + 募集あり');
    expect(stockReason({ isNewgrad: false, isGame: false, hasOpening: false })).toBe('');
  });
});
