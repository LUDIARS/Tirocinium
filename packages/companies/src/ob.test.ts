import { describe, it, expect } from 'vitest';
import {
  normalizeObPlacement,
  parseCsv,
  parseObCsv,
  parseObJson,
  parseObInput,
  dedupeObPlacements,
  buildObSummary,
} from './ob.js';
import { normalizeName } from './normalize.js';
import type { NormalizedObPlacement, ObPlacement } from './types.js';

describe('normalizeObPlacement', () => {
  it('正規化し normalized_name を社名から導く', () => {
    const r = normalizeObPlacement({
      company: '株式会社カプコン', join_year: 2024, class_name: 'GP専攻', role: 'プランナー', headcount: 3,
    });
    expect(r).not.toBeNull();
    expect(r!.normalized_name).toBe(normalizeName('株式会社カプコン'));
    expect(r!.join_year).toBe(2024);
    expect(r!.headcount).toBe(3);
  });

  it('社名空 / 人数0 / 不正人数 は null (投入対象外)', () => {
    expect(normalizeObPlacement({ company: '', headcount: 3 })).toBeNull();
    expect(normalizeObPlacement({ company: 'X社', headcount: 0 })).toBeNull();
    expect(normalizeObPlacement({ company: 'X社' })).toBeNull();
  });

  it('入社年は妥当域外 (文字混じり含む) を 0=不明 に丸める', () => {
    expect(normalizeObPlacement({ company: 'X社', join_year: 1800, headcount: 1 })!.join_year).toBe(0);
    expect(normalizeObPlacement({ company: 'X社', join_year: '2023年度' as unknown as number, headcount: 1 })!.join_year).toBe(2023);
  });
});

describe('parseCsv', () => {
  it('クォート内のカンマ・改行・""エスケープを保つ', () => {
    const rows = parseCsv('a,b\n"x,y","line1\nline2"\n"he said ""hi""",z');
    expect(rows[0]).toEqual(['a', 'b']);
    expect(rows[1]).toEqual(['x,y', 'line1\nline2']);
    expect(rows[2]).toEqual(['he said "hi"', 'z']);
  });
  it('空行を捨てる', () => {
    expect(parseCsv('a\n\n\nb')).toEqual([['a'], ['b']]);
  });
});

describe('parseObCsv', () => {
  it('ヘッダの別名列を寄せ、 未知列 (個人列) は無視する', () => {
    const csv = [
      '会社名,氏名,入社年,クラス,役職,人数',
      '株式会社カプコン,山田太郎,2024,GP専攻,プランナー,3',
    ].join('\n');
    const rows = parseObCsv(csv);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.company).toBe('株式会社カプコン');
    expect(r.join_year).toBe(2024);
    expect(r.role).toBe('プランナー');
    expect(r.headcount).toBe(3);
    // 氏名列は構造的に拾わない (個人データを持てない)
    expect(Object.values(r)).not.toContain('山田太郎');
  });
  it('ヘッダのみ / 空は空配列', () => {
    expect(parseObCsv('会社名,人数')).toEqual([]);
    expect(parseObCsv('')).toEqual([]);
  });
});

describe('parseObJson / parseObInput', () => {
  it('英語キーの JSON 配列を寄せる', () => {
    const rows = parseObJson([{ company: 'X社', year: 2023, headcount: 2, name: '無視' }]);
    expect(rows[0]).toMatchObject({ company: 'X社', join_year: 2023, headcount: 2 });
  });
  it('parseObInput は JSON/CSV を自動判別', () => {
    expect(parseObInput('[{"company":"X社","人数":1}]')[0]!.company).toBe('X社');
    expect(parseObInput('会社名,人数\nX社,1')[0]!.headcount).toBe(1);
    expect(parseObInput('{ broken')).toEqual([]);
  });
});

describe('dedupeObPlacements', () => {
  it('同一キー (年×クラス×役職) を合算する', () => {
    const mk = (headcount: number): NormalizedObPlacement => ({
      company_name: 'X社', normalized_name: 'x社', join_year: 2024, class_name: 'A', role: 'プランナー', headcount,
    });
    const out = dedupeObPlacements([mk(2), mk(3)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.headcount).toBe(5);
  });
});

describe('buildObSummary', () => {
  it('total / 年別 / 役職別 / クラス別 を集計しソートする', () => {
    const rows: ObPlacement[] = [
      { join_year: 2024, class_name: 'A', role: 'プランナー', headcount: 3, source: 'user' },
      { join_year: 2023, class_name: 'B', role: 'プランナー', headcount: 1, source: 'user' },
      { join_year: 2024, class_name: 'A', role: 'プログラマ', headcount: 2, source: 'user' },
    ];
    const s = buildObSummary(rows);
    expect(s.total).toBe(6);
    expect(s.cells).toBe(3);
    expect(s.by_year).toEqual([
      { join_year: 2024, headcount: 5 },
      { join_year: 2023, headcount: 1 },
    ]);
    expect(s.by_role[0]).toEqual({ role: 'プランナー', headcount: 4 });
    expect(s.by_class[0]).toEqual({ class_name: 'A', headcount: 5 });
  });
  it('join_year=0 (不明) は by_year に出さない', () => {
    const s = buildObSummary([{ join_year: 0, class_name: '', role: '', headcount: 4, source: 'user' }]);
    expect(s.total).toBe(4);
    expect(s.by_year).toEqual([]);
  });
});
