// 実 SQLite で listCompanies の quality フィルタを裏取りする。
// quality=1 は「ゲーム紐付け or 求人(job_postings)あり」の企業を残し、 どちらも無い企業を除外する。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { normalizeCompany } from '@tirocinium/companies';
import { config } from '../config.js';
import { initSql, sql } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { listCompanies, upsertCompany } from './repo.js';

const dbPath = join(tmpdir(), `tr-quality-${randomUUID()}.sqlite`);

beforeAll(async () => {
  config.databaseUrl = dbPath;
  initSql();
  await runMigrations();
});

afterAll(async () => {
  await sql.end();
  for (const suf of ['', '-shm', '-wal']) { try { rmSync(dbPath + suf); } catch { /* noop */ } }
});

async function idOf(normalized: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM companies WHERE normalized_name = ${normalized}`;
  return rows[0]!.id;
}

describe('listCompanies quality フィルタ', () => {
  it('ゲームも求人も無い企業は除外、 求人だけある企業は残す', async () => {
    // bare: ゲーム紐付けも求人も無い → quality で除外されるべき
    await upsertCompany(normalizeCompany({ name: 'バレ会社', source: 'test' })!);
    // openings: ゲーム紐付け無し・求人あり → quality で残るべき (今回の修正点)
    await upsertCompany(normalizeCompany({ name: '求人会社', source: 'test' })!);
    const openId = await idOf('求人会社');
    await sql`
      INSERT INTO job_postings (source, kind, dedup_key, url, title, company_name, company_id)
      VALUES ('s', 'recruit-page', ${'k-' + openId}, 'http://x/1', '3Dアーティスト', '求人会社', ${openId})
    `;

    const names = (await listCompanies({ quality: true })).map((c) => c.name);
    expect(names).toContain('求人会社'); // 求人があるので残る
    expect(names).not.toContain('バレ会社'); // ゲームも求人も無いので除外

    // quality を外せば bare も出る (フィルタが効いている確認)。
    const all = (await listCompanies({})).map((c) => c.name);
    expect(all).toContain('バレ会社');
  });
});
