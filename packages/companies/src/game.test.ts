import { describe, it, expect } from 'vitest';
import { normalizeTitle, splitTopLevel, parseGamesFromResearch, normalizeGame } from './game.js';

describe('normalizeTitle', () => {
  it('lowercases, strips spaces/symbols, NFKC', () => {
    expect(normalizeTitle('Final Fantasy VII')).toBe('finalfantasyvii');
    // NFKC: 全角英数/ローマ数字を畳む
    expect(normalizeTitle('ファイナルファンタジー Ⅶ')).toBe(normalizeTitle('ファイナルファンタジーVII'));
  });
  it('folds version suffixes (リマスター/HD版)', () => {
    expect(normalizeTitle('クロノ・トリガー リマスター')).toBe(normalizeTitle('クロノトリガー'));
    expect(normalizeTitle('ABC HD版')).toBe('abc');
  });
  it('returns empty for junk', () => {
    expect(normalizeTitle('・・・')).toBe('');
  });
});

describe('splitTopLevel', () => {
  it('splits on 、 but protects parens', () => {
    expect(splitTopLevel('A(x、y)、B(z)、C')).toEqual(['A(x、y)', 'B(z)', 'C']);
  });
  it('handles fullwidth parens', () => {
    expect(splitTopLevel('A（x、y）、B')).toEqual(['A（x、y）', 'B']);
  });
});

describe('parseGamesFromResearch', () => {
  it('parses title/year/role and dedups', () => {
    const links = parseGamesFromResearch({
      game_kind: 'ソーシャル',
      games: 'クラッシュフィーバー(パズルRPG、2016年配信・10周年継続運営中)、ジャンプチ ヒーローズ(少年ジャンプIPパズルRPG、サービス終了)',
    });
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({ title: 'クラッシュフィーバー', role: 'developer', year: 2016, kind: 'ソーシャル' });
    expect(links[1]!.role).toBe('developer');
  });
  it('detects support role from 開発協力', () => {
    const links = parseGamesFromResearch({
      games: 'スーパーマリオ オデッセイ(2017年、開発協力)、あつまれ どうぶつの森(2020年、開発協力)',
    });
    expect(links.every((l) => l.role === 'support')).toBe(true);
    expect(links[0]).toMatchObject({ title: 'スーパーマリオ オデッセイ', year: 2017 });
  });
  it('returns [] for empty', () => {
    expect(parseGamesFromResearch({})).toEqual([]);
  });
});

describe('normalizeGame', () => {
  it('builds normalized game, null on empty title', () => {
    const g = normalizeGame({ title: '神託のメソロギア', release_year: 2025, source: 'game-seed' });
    expect(g?.normalized_title).toBe(normalizeTitle('神託のメソロギア'));
    expect(g?.release_year).toBe(2025);
    expect(normalizeGame({ title: '' })).toBeNull();
  });
});
