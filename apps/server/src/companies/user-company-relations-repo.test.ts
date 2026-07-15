import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { initSql, sql } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { upsertCompany } from './repo.js';
import {
  deleteUserCompanyRelation,
  listUserCompanyRelations,
  upsertUserCompanyRelation,
} from './user-company-relations-repo.js';

const dbPath = join(tmpdir(), `tr-user-companies-${randomUUID()}.sqlite`);

beforeAll(async () => {
  config.databaseUrl = dbPath;
  initSql();
  await runMigrations();
  await upsertCompany({
    name: 'Example Games',
    normalized_name: 'examplegames',
    url: 'https://example.test',
    industry: 'ゲーム',
    description: '',
    roles: [],
    tags: [],
    location: '',
    size: '',
    employee_count: 0,
    listing_market: '',
    source: 'manual',
    source_url: '',
  });
});

afterAll(async () => {
  await sql.end();
  for (const suffix of ['', '-shm', '-wal']) {
    try { rmSync(dbPath + suffix); } catch { /* noop */ }
  }
});

describe('user company relations (real sqlite)', () => {
  it('Cernere userごとに志望企業と内定情報を登録・更新できる', async () => {
    const company = (await sql<{ id: string }[]>`
      SELECT id FROM companies WHERE normalized_name = ${'examplegames'}
    `)[0]!;

    await upsertUserCompanyRelation('cernere-user-1', company.id, 'desired');
    await upsertUserCompanyRelation('cernere-user-1', company.id, 'offer', {
      roleTitle: 'ゲームプログラマー',
      offeredOn: '2026-07-15',
    });

    let rows = await listUserCompanyRelations('cernere-user-1');
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.relation_type === 'offer')).toMatchObject({
      company_name: 'Example Games',
      role_title: 'ゲームプログラマー',
      offered_on: '2026-07-15',
    });

    await upsertUserCompanyRelation('cernere-user-1', company.id, 'offer', {
      roleTitle: 'テクニカルアーティスト',
      offeredOn: null,
    });
    rows = await listUserCompanyRelations('cernere-user-1');
    expect(rows.find((row) => row.relation_type === 'offer')).toMatchObject({
      role_title: 'テクニカルアーティスト',
      offered_on: null,
    });

    await deleteUserCompanyRelation('cernere-user-1', company.id, 'desired');
    expect(await listUserCompanyRelations('cernere-user-1')).toHaveLength(1);
    expect(await listUserCompanyRelations('another-user')).toEqual([]);
  });

  it('存在しない企業は登録しない', async () => {
    expect(await upsertUserCompanyRelation(
      'cernere-user-1',
      randomUUID(),
      'desired',
    )).toBeNull();
  });
});
