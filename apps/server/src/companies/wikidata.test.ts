import { describe, it, expect } from 'vitest';
import { parseGameRows, cleanCompanyLabel } from './wikidata.js';

describe('cleanCompanyLabel', () => {
  it('strips legal suffix and parenthetical for Wikidata label match', () => {
    expect(cleanCompanyLabel('株式会社カプコン')).toBe('カプコン');
    expect(cleanCompanyLabel('グリー株式会社（グリーホールディングス株式会社）')).toBe('グリー');
  });
});

describe('parseGameRows', () => {
  const b = (game: string, gameLabel: string, dev?: string, pub?: string, series?: string) => ({
    game: { value: game },
    gameLabel: { value: gameLabel },
    ...(dev ? { devLabel: { value: dev } } : {}),
    ...(pub ? { pubLabel: { value: pub } } : {}),
    ...(series ? { seriesLabel: { value: series } } : {}),
  });

  it('aggregates dev/pub/series per game, dedups', () => {
    const rows = parseGameRows([
      b('http://q/Q1', 'ロックマンX', 'カプコン', 'カプコン', 'ロックマン'),
      b('http://q/Q1', 'ロックマンX', 'カプコン', 'Elite Systems', 'ロックマンXシリーズ'),
      b('http://q/Q2', '1943', 'カプコン', 'U.S. Gold', '194X'),
    ]);
    expect(rows).toHaveLength(2);
    const x = rows.find((r) => r.title === 'ロックマンX')!;
    expect(x.developers).toEqual(['カプコン']);
    expect(x.publishers).toEqual(['カプコン', 'Elite Systems']);
    expect(x.series).toEqual(['ロックマン', 'ロックマンXシリーズ']);
  });

  it('skips rows without a game label', () => {
    expect(parseGameRows([{ game: { value: 'http://q/Q9' } }])).toEqual([]);
  });
});
