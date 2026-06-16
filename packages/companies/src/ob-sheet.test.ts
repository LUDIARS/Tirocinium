import { describe, it, expect } from 'vitest';
import { parseObSheetValues, aggregateObPersons, diffObCells } from './ob-sheet.js';

describe('parseObSheetValues', () => {
  it('ヘッダで列を解決し氏名つき個人行を取り出す (列順自由・未知列無視)', () => {
    const values = [
      ['氏名', '会社名', '入社年', 'クラス', '役職', 'メモ'],
      ['山田 太郎', '株式会社カプコン', '2024', 'ゲームプランナー専攻', 'プランナー', '内定'],
      ['鈴木 花子', '株式会社カプコン', '2024年入社', 'ゲームプランナー専攻', 'プランナー', ''],
    ];
    const rows = parseObSheetValues(values);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: '山田 太郎', company: '株式会社カプコン', join_year: 2024, role: 'プランナー' });
    // '2024年入社' のような表記でも年だけ抽出される
    expect(rows[1]!.join_year).toBe(2024);
  });

  it('会社未記入・全空の行はスキップする', () => {
    const values = [
      ['氏名', '会社名'],
      ['名無し', ''],
      ['', ''],
      ['田中', '任天堂'],
    ];
    const rows = parseObSheetValues(values);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.company).toBe('任天堂');
  });

  it('ヘッダ別表記 (内定先 / 卒業年 / 職種 / 氏名(かな)) を寄せる', () => {
    const values = [
      ['氏名(かな)', '内定先', '卒業年', '職種'],
      ['やまだ', 'コナミ', '2023', 'エンジニア'],
    ];
    const rows = parseObSheetValues(values);
    expect(rows[0]).toMatchObject({ name: 'やまだ', company: 'コナミ', join_year: 2023, role: 'エンジニア' });
  });

  it('ヘッダのみ / 空は空配列', () => {
    expect(parseObSheetValues([['氏名', '会社名']])).toEqual([]);
    expect(parseObSheetValues([])).toEqual([]);
  });
});

describe('aggregateObPersons (氏名破棄 + 集計)', () => {
  it('同一キーを人数に畳み、返り値に氏名フィールドが存在しない', () => {
    const rows = parseObSheetValues([
      ['氏名', '会社名', '入社年', 'クラス', '役職'],
      ['山田 太郎', '株式会社カプコン', '2024', 'プランナー専攻', 'プランナー'],
      ['鈴木 花子', '株式会社カプコン', '2024', 'プランナー専攻', 'プランナー'],
      ['佐藤 次郎', '株式会社カプコン', '2024', 'プランナー専攻', 'プログラマ'],
    ]);
    const cells = aggregateObPersons(rows);
    // (カプコン,2024,プランナー専攻,プランナー)=2 と (…,プログラマ)=1 の 2 セル
    expect(cells).toHaveLength(2);
    const planner = cells.find((c) => c.role === 'プランナー')!;
    expect(planner.headcount).toBe(2);
    expect(planner.normalized_name).toBe('カプコン');
    // 氏名は集計後のオブジェクトに一切残らない (個人データ境界 §2.1)
    for (const c of cells) {
      expect(Object.keys(c)).not.toContain('name');
      expect(JSON.stringify(c)).not.toContain('山田');
      expect(JSON.stringify(c)).not.toContain('鈴木');
    }
  });

  it('社名が正規化後に空なら除外', () => {
    const cells = aggregateObPersons([
      { name: 'x', company: '（）', join_year: 0, class_name: '', role: '' },
    ]);
    expect(cells).toEqual([]);
  });
});

describe('diffObCells', () => {
  const key = (c: { id: string }) => c.id;
  it('新規 / 変更 (headcount差) / 削除 を判定する', () => {
    const prev = [
      { id: 'a', headcount: 2 },
      { id: 'b', headcount: 1 },
      { id: 'c', headcount: 3 },
    ];
    const next = [
      { id: 'a', headcount: 2 }, // 不変
      { id: 'b', headcount: 4 }, // 変更
      { id: 'd', headcount: 1 }, // 新規
      // c は削除
    ];
    const diff = diffObCells(prev, next, key);
    expect(diff.added.map((c) => c.id)).toEqual(['d']);
    expect(diff.updated.map((c) => c.id)).toEqual(['b']);
    expect(diff.removed.map((c) => c.id)).toEqual(['c']);
  });

  it('prev 空なら全部 added、 next 空なら全部 removed', () => {
    expect(diffObCells([], [{ id: 'a', headcount: 1 }], key).added).toHaveLength(1);
    expect(diffObCells([{ id: 'a', headcount: 1 }], [], key).removed).toHaveLength(1);
  });
});
