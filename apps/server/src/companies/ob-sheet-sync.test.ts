import { describe, it, expect } from 'vitest';
import { runObSheetSync, type ObSheetSyncDeps } from './ob-sheet-sync.js';
import type { ObCellRow } from './ob-repo.js';

/** in-memory な DB / Sheet を持つ fake deps を組む。 */
function makeDeps(opts: {
  values: string[][];
  // normalized_name → company_id (未登録は未解決)
  companyIds: Record<string, string>;
  existing?: ObCellRow[];
  dryRun?: boolean;
}): {
  deps: ObSheetSyncDeps;
  store: Map<string, ObCellRow>;
  upserts: ObCellRow[];
  deletes: ObCellRow[];
} {
  const k = (c: ObCellRow) => `${c.company_id} ${c.join_year} ${c.class_name} ${c.role}`;
  const store = new Map<string, ObCellRow>((opts.existing ?? []).map((c) => [k(c), c]));
  const upserts: ObCellRow[] = [];
  const deletes: ObCellRow[] = [];
  const deps: ObSheetSyncDeps = {
    readValues: async () => opts.values,
    resolveCompanyId: async (n) => opts.companyIds[n] ?? null,
    getExistingCells: async () => [...store.values()],
    upsertCell: async (c) => { upserts.push(c); store.set(k(c), c); },
    deleteCell: async (c) => { deletes.push(c); store.delete(k(c)); },
    dryRun: opts.dryRun,
  };
  return { deps, store, upserts, deletes };
}

const HEADER = ['氏名', '会社名', '入社年', 'クラス', '役職'];

describe('runObSheetSync', () => {
  it('氏名つき個人行を集計に畳み、 解決済セルを upsert する (新規同期)', async () => {
    const { deps, upserts } = makeDeps({
      values: [
        HEADER,
        ['山田 太郎', '株式会社カプコン', '2024', 'プランナー専攻', 'プランナー'],
        ['鈴木 花子', '株式会社カプコン', '2024', 'プランナー専攻', 'プランナー'],
        ['佐藤 次郎', '任天堂株式会社', '2024', 'プログラム専攻', 'プログラマ'],
      ],
      companyIds: { カプコン: 'cap', 任天堂: 'nin' },
    });
    const s = await runObSheetSync(deps);
    expect(s.persons).toBe(3);
    expect(s.cells).toBe(2); // カプコン×プランナー(2) と 任天堂×プログラマ(1)
    expect(s.resolved).toBe(2);
    expect(s.added).toBe(2);
    expect(s.headcount).toBe(3);
    expect(s.companies).toBe(2);
    // upsert されたセルに氏名が無い (個人データ境界)
    const cap = upserts.find((c) => c.company_id === 'cap')!;
    expect(cap.headcount).toBe(2);
    expect(JSON.stringify(upserts)).not.toContain('山田');
    expect(JSON.stringify(upserts)).not.toContain('鈴木');
  });

  it('headcount 変更は updated、 Sheet から消えたセルは removed (delete)', async () => {
    const { deps, upserts, deletes } = makeDeps({
      values: [
        HEADER,
        ['a', 'カプコン', '2024', 'プランナー専攻', 'プランナー'],
        ['b', 'カプコン', '2024', 'プランナー専攻', 'プランナー'],
      ],
      companyIds: { カプコン: 'cap' },
      existing: [
        // 前回: カプコン×プランナー=1 (→ 今回 2 に増える = updated)
        { company_id: 'cap', join_year: 2024, class_name: 'プランナー専攻', role: 'プランナー', headcount: 1 },
        // 前回だけにある (→ Sheet から消えた = removed)
        { company_id: 'cap', join_year: 2023, class_name: '旧専攻', role: 'デザイナー', headcount: 5 },
      ],
    });
    const s = await runObSheetSync(deps);
    expect(s.added).toBe(0);
    expect(s.updated).toBe(1);
    expect(s.removed).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.headcount).toBe(2);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.join_year).toBe(2023);
  });

  it('変更が無ければ upsert / delete とも発生しない (冪等)', async () => {
    const { deps, upserts, deletes } = makeDeps({
      values: [HEADER, ['a', 'カプコン', '2024', 'プランナー専攻', 'プランナー']],
      companyIds: { カプコン: 'cap' },
      existing: [{ company_id: 'cap', join_year: 2024, class_name: 'プランナー専攻', role: 'プランナー', headcount: 1 }],
    });
    const s = await runObSheetSync(deps);
    expect(s.added + s.updated + s.removed).toBe(0);
    expect(upserts).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it('未解決社名は報告のみ (DB へ書かない)', async () => {
    const { deps, upserts } = makeDeps({
      values: [HEADER, ['a', '謎の無名スタジオ', '2024', 'X', 'Y']],
      companyIds: {},
    });
    const s = await runObSheetSync(deps);
    expect(s.resolved).toBe(0);
    expect(s.unresolved).toBe(1);
    expect(s.unresolvedNames).toContain('謎の無名スタジオ');
    expect(upserts).toHaveLength(0);
  });

  it('dryRun は差分を算出するが DB へ反映しない', async () => {
    const { deps, upserts, deletes } = makeDeps({
      values: [HEADER, ['a', 'カプコン', '2024', 'X', 'Y']],
      companyIds: { カプコン: 'cap' },
      dryRun: true,
    });
    const s = await runObSheetSync(deps);
    expect(s.dryRun).toBe(true);
    expect(s.added).toBe(1);
    expect(upserts).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });
});
