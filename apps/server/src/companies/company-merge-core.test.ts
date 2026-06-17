import { describe, it, expect, vi } from 'vitest';
import { runDuplicateMerge, type DuplicateMergeDeps, type DuplicateGroup } from './company-merge-core.js';
import type { Company } from '@tirocinium/companies';

// ── fakes ──────────────────────────────────────────────────────────────────

function makeCompany(id: string, overrides: Partial<Company> = {}): Company {
  return {
    id,
    name: `企業${id}`,
    normalized_name: `企業${id}`,
    url: '',
    industry: '',
    description: '',
    roles: [],
    tags: [],
    location: '',
    size: '',
    employee_count: 0,
    listing_market: '',
    source: '',
    source_url: '',
    is_newgrad: false,
    is_game: false,
    has_opening: false,
    recruit_url: '',
    stock_reason: '',
    sources: [],
    is_smb: false,
    is_listed: false,
    corporate_number: '1234567890123',
    crawled_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeGroup(ids: string[], overrides?: Partial<Company>): DuplicateGroup {
  return {
    corporateNumber: '1234567890123',
    candidates: ids.map((id, i) => ({
      id,
      url: '',
      description: '',
      crawled_at: `2024-0${i + 1}-01T00:00:00.000Z`,
      gameCount: 0,
      obCount: 0,
      company: makeCompany(id, overrides),
    })),
  };
}

/** 記録付き fake deps を組む。 */
function makeDeps(
  groups: DuplicateGroup[],
  opts: { dryRun?: boolean } = {},
): {
  deps: DuplicateMergeDeps;
  repoints: { dupId: string; survivorId: string }[];
  applied: { survivorId: string }[];
  deleted: string[];
} {
  const repoints: { dupId: string; survivorId: string }[] = [];
  const applied: { survivorId: string }[] = [];
  const deleted: string[] = [];

  const deps: DuplicateMergeDeps = {
    getDuplicateGroups: async () => groups,
    repointAll: async (dupId, survivorId) => {
      repoints.push({ dupId, survivorId });
      return 3; // 仮の repoint 数
    },
    applySurvivorFields: async (survivorId) => {
      applied.push({ survivorId });
    },
    deleteCompany: async (id) => {
      deleted.push(id);
    },
    dryRun: opts.dryRun,
  };
  return { deps, repoints, applied, deleted };
}

// ── テスト ────────────────────────────────────────────────────────────────

describe('runDuplicateMerge', () => {
  it('1 グループ 2 行を survivor/loser に振り分けて repoint→delete する', async () => {
    // id 昇順 tie-break で 'a' が survivor になる (同スコア・同 crawled_at)
    const groups = [makeGroup(['a', 'b'])];
    const { deps, repoints, deleted, applied } = makeDeps(groups);

    const summary = await runDuplicateMerge(deps);

    expect(summary.groups).toBe(1);
    expect(summary.merged).toBe(1);
    expect(summary.deleted).toBe(1);
    expect(summary.dryRun).toBe(false);

    // loser=b が survivor=a に repoint される
    expect(repoints).toHaveLength(1);
    expect(repoints[0]).toMatchObject({ dupId: 'b', survivorId: 'a' });

    // b が削除される
    expect(deleted).toEqual(['b']);

    // survivor フィールドが更新される
    expect(applied).toHaveLength(1);
    expect(applied[0]!.survivorId).toBe('a');
  });

  it('複数グループを処理できる', async () => {
    const groups = [makeGroup(['a', 'b']), makeGroup(['c', 'd'])];
    const { deps, deleted } = makeDeps(groups);

    const summary = await runDuplicateMerge(deps);

    expect(summary.groups).toBe(2);
    expect(summary.merged).toBe(2);
    expect(deleted).toHaveLength(2);
  });

  it('dryRun では repoint/delete が呼ばれない', async () => {
    const groups = [makeGroup(['a', 'b'])];
    const { deps, repoints, deleted, applied } = makeDeps(groups, { dryRun: true });

    const summary = await runDuplicateMerge(deps);

    expect(summary.dryRun).toBe(true);
    expect(summary.merged).toBe(1); // グループは認識する
    expect(repoints).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    expect(applied).toHaveLength(0);
  });

  it('survivor 選定がスコアに基づいている (url 有り→survivor)', async () => {
    const groups: DuplicateGroup[] = [
      {
        corporateNumber: '9999999999999',
        candidates: [
          {
            id: 'rich',
            url: 'https://capcom.com',
            description: '大手',
            crawled_at: '2024-01-01T00:00:00.000Z',
            gameCount: 10,
            obCount: 5,
            company: makeCompany('rich', { url: 'https://capcom.com', description: '大手' }),
          },
          {
            id: 'poor',
            url: '',
            description: '',
            crawled_at: '2024-01-01T00:00:00.000Z',
            gameCount: 0,
            obCount: 0,
            company: makeCompany('poor'),
          },
        ],
      },
    ];
    const { deps, repoints, deleted } = makeDeps(groups);

    await runDuplicateMerge(deps);

    // rich が survivor、 poor が loser
    expect(repoints[0]).toMatchObject({ dupId: 'poor', survivorId: 'rich' });
    expect(deleted).toEqual(['poor']);
  });

  it('グループが 1 件のみなら何もしない', async () => {
    const groups: DuplicateGroup[] = [
      {
        corporateNumber: '1111111111111',
        candidates: [
          {
            id: 'solo',
            url: '',
            description: '',
            crawled_at: '2024-01-01T00:00:00.000Z',
            gameCount: 0,
            obCount: 0,
            company: makeCompany('solo'),
          },
        ],
      },
    ];
    const { deps, repoints, deleted } = makeDeps(groups);
    const summary = await runDuplicateMerge(deps);

    expect(summary.merged).toBe(0);
    expect(repoints).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it('repointed はすべての loser の repointAll 戻り値の合計', async () => {
    // 3 グループ × 各グループ 2 losers × repointAll 戻り値 3 = 18
    const groups = [
      makeGroup(['a', 'b', 'c']),
    ];
    const { deps, repoints } = makeDeps(groups);

    const summary = await runDuplicateMerge(deps);

    // a=survivor (id 昇順), b/c=losers
    expect(summary.merged).toBe(2); // 2 losers
    expect(repoints).toHaveLength(2);
    expect(summary.repointed).toBe(6); // 2 × 3
  });
});
