import { describe, it, expect } from 'vitest';
import { normalizeTitle, normalizeSeries, splitTopLevel, parseGamesFromResearch, normalizeGame, classifyPlatform, pickRepresentativeGames } from './game.js';

describe('classifyPlatform', () => {
  it('mobile-only → mobile', () => {
    expect(classifyPlatform(['Android', 'iOS'])).toBe('mobile');
  });
  it('has console → console (even with mobile)', () => {
    expect(classifyPlatform(['Nintendo Switch', 'iOS'])).toBe('console');
    expect(classifyPlatform(['PlayStation 5'])).toBe('console');
  });
  it('pc only → pc', () => {
    expect(classifyPlatform(['Microsoft Windows', 'Steam'])).toBe('pc');
  });
  it('unknown → empty', () => {
    expect(classifyPlatform([])).toBe('');
  });
});

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

describe('normalizeSeries', () => {
  it('mechanically normalizes (NFKC + lower + strip シリーズ/spaces/symbols)', () => {
    expect(normalizeSeries('ロックマン シリーズ')).toBe('ロックマン');
    expect(normalizeSeries('Ｍｅｔａｌ Ｇｅａｒ')).toBe('metalgear');
  });
  it('folds known aliases / 略称 to the parent key', () => {
    expect(normalizeSeries('FF')).toBe('ファイナルファンタジー');
    expect(normalizeSeries('ファイナルファンタジー')).toBe('ファイナルファンタジー');
    expect(normalizeSeries('Final Fantasy')).toBe('ファイナルファンタジー');
    expect(normalizeSeries('ドラクエ')).toBe('ドラゴンクエスト');
  });
  it('folds a sub-series into its parent (ファブラ ノヴァ クリスタリス FF → FF)', () => {
    expect(normalizeSeries('ファブラ ノヴァ クリスタリス FF')).toBe('ファイナルファンタジー');
    expect(normalizeSeries('FF')).toBe(normalizeSeries('ファブラ ノヴァ クリスタリス FF'));
  });
  it('does NOT over-merge unknown series (mechanical only)', () => {
    expect(normalizeSeries('オリジナル新規IP')).toBe('オリジナル新規ip');
    expect(normalizeSeries('未知シリーズA')).not.toBe(normalizeSeries('未知シリーズB'));
  });
  it('returns empty for empty / junk', () => {
    expect(normalizeSeries('')).toBe('');
    expect(normalizeSeries('・・・')).toBe('');
  });
});

describe('normalizeGame', () => {
  it('builds normalized game, null on empty title', () => {
    const g = normalizeGame({ title: '神託のメソロギア', release_year: 2025, source: 'game-seed' });
    expect(g?.normalized_title).toBe(normalizeTitle('神託のメソロギア'));
    expect(g?.release_year).toBe(2025);
    expect(normalizeGame({ title: '' })).toBeNull();
  });
  it('derives normalized_series from series (folds 略称)', () => {
    const g = normalizeGame({ title: 'ファイナルファンタジーXVI', series: 'FF', source: 'wikidata' });
    expect(g?.series).toBe('FF');
    expect(g?.normalized_series).toBe('ファイナルファンタジー');
    expect(normalizeGame({ title: '無印', source: 'x' })?.normalized_series).toBe('');
  });
});

describe('pickRepresentativeGames', () => {
  const g = (title: string, series: string, release_year: number, role: string) => ({ title, series, release_year, role });

  it('シリーズ単位で 1 作 (最新年) に畳む', () => {
    const out = pickRepresentativeGames(
      [
        g('FFXV', 'ファイナルファンタジー', 2016, 'developer'),
        g('FFXVI', 'FF', 2023, 'developer'), // 同シリーズ (略称) → 畳む。 新しい 2023 が代表
        g('ドラクエXI', 'ドラゴンクエスト', 2017, 'developer'),
      ],
      5,
    );
    expect(out).toHaveLength(2);
    const ff = out.find((x) => x.series === 'FF' || x.series === 'ファイナルファンタジー')!;
    expect(ff.release_year).toBe(2023);
  });

  it('自社開発/発売を関与のみ (support/credited) より優先する', () => {
    const out = pickRepresentativeGames(
      [
        g('手伝った大作', '', 2024, 'support'),
        g('自社作', '', 2020, 'developer'),
      ],
      2,
    );
    expect(out[0]!.title).toBe('自社作'); // 新しくても support は後ろ
  });

  it('n 件で打ち切り、 release_year 降順', () => {
    const out = pickRepresentativeGames(
      [g('A', '', 2020, 'developer'), g('B', '', 2022, 'developer'), g('C', '', 2021, 'developer')],
      2,
    );
    expect(out.map((x) => x.title)).toEqual(['B', 'C']);
  });

  it('n<=0 や空は空配列、 タイトル空は除外', () => {
    expect(pickRepresentativeGames([g('A', '', 2020, 'developer')], 0)).toEqual([]);
    expect(pickRepresentativeGames([], 3)).toEqual([]);
    expect(pickRepresentativeGames([g('', '', 2020, 'developer')], 3)).toEqual([]);
  });
});
