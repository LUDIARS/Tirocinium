// 実 SQLite に対して ob_question_patterns の upsert / 重複畳み込みを裏取りする
// (crawl-queue-repo.test.ts と同じ実 SQL 経路パターン)。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { config } from '../config.js';
import { initSql, sql } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { countObPatterns, upsertObPattern } from './repo.js';

const dbPath = join(tmpdir(), `tr-obp-${randomUUID()}.sqlite`);
let companyId = '';

beforeAll(async () => {
  config.databaseUrl = dbPath;
  initSql();
  await runMigrations();
  await sql`INSERT INTO companies (name, normalized_name) VALUES ('Example', 'example-obp')`;
  const rows = await sql<{ id: string }[]>`SELECT id FROM companies WHERE normalized_name = 'example-obp'`;
  companyId = rows[0]!.id;
});

afterAll(async () => {
  await sql.end();
  for (const suffix of ['', '-shm', '-wal']) {
    try { rmSync(dbPath + suffix); } catch { /* noop */ }
  }
});

describe('upsertObPattern', () => {
  it('新規 insert → 同一 (company, theme, question) は dedup + source_refs マージ', async () => {
    const base = {
      companyId,
      stage: '',
      role: 'general',
      theme: 'チーム開発',
      questionPattern: '衝突をどう解決したか',
      followupPatterns: ['個人の判断は?'],
      axes: ['demeanor'],
      contributorAlias: 'OB#aaaaaa',
    };
    const first = await upsertObPattern({ ...base, sourceRefs: ['memoria://a'] });
    expect(first.deduped).toBe(false);

    const second = await upsertObPattern({ ...base, sourceRefs: ['memoria://b'] });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);

    const rows = await sql<{ source_refs: unknown }[]>`
      SELECT source_refs FROM ob_question_patterns WHERE id = ${first.id}
    `;
    const refs = typeof rows[0]!.source_refs === 'string'
      ? (JSON.parse(rows[0]!.source_refs as string) as string[])
      : (rows[0]!.source_refs as string[]);
    expect(refs.sort()).toEqual(['memoria://a', 'memoria://b']);
    expect(await countObPatterns(companyId)).toBe(1);
  });

  it('別テーマは別行', async () => {
    await upsertObPattern({
      companyId,
      stage: 'hr',
      role: 'programmer',
      theme: '志望動機',
      questionPattern: 'なぜ当社か',
      followupPatterns: [],
      axes: ['target_fit'],
      sourceRefs: [],
      contributorAlias: 'OB#bbbbbb',
    });
    expect(await countObPatterns(companyId)).toBe(2);
  });

  it('同一パターンへの複数 OB 由来 alias は contributor_aliases に蓄積される (単一alias で上書きされない)', async () => {
    const base = {
      companyId,
      stage: '',
      role: 'general',
      theme: 'チーム開発2',
      questionPattern: '衝突解決の役割分担',
      followupPatterns: [],
      axes: [] as string[],
    };
    const first = await upsertObPattern({ ...base, sourceRefs: [], contributorAlias: 'OB#111111111111' });
    await upsertObPattern({ ...base, sourceRefs: [], contributorAlias: 'OB#222222222222' });

    const rows = await sql<{ contributor_aliases: unknown }[]>`
      SELECT contributor_aliases FROM ob_question_patterns WHERE id = ${first.id}
    `;
    const aliases = typeof rows[0]!.contributor_aliases === 'string'
      ? (JSON.parse(rows[0]!.contributor_aliases as string) as string[])
      : (rows[0]!.contributor_aliases as string[]);
    expect(aliases.sort()).toEqual(['OB#111111111111', 'OB#222222222222']);
  });

  it('DB 側の一意制約 (migration 025 uq_obqp_dedup) が同一パターンの重複行を拒否する', async () => {
    // upsertObPattern の原子的 upsert (INSERT → unique violation なら UPDATE へ合流) は
    // この一意制約が最終防波堤になっている前提 — 制約自体が効いていることを直接確認する
    // (node:sqlite は単一コネクションのため、アプリ層の並行呼び出しでは真の競合を再現できない)。
    const theme = '一意制約テスト';
    const questionPattern = '一意性の確認';
    await upsertObPattern({
      companyId,
      stage: '',
      role: 'general',
      theme,
      questionPattern,
      followupPatterns: [],
      axes: [],
      sourceRefs: [],
      contributorAlias: 'OB#cccccccccccc',
    });

    await expect(
      sql`
        INSERT INTO ob_question_patterns
          (company_id, stage, role, theme, question_pattern, followup_patterns, axes, source_refs, contributor_aliases)
        VALUES (${companyId}, '', 'general', ${theme}, ${questionPattern}, '[]', '[]', '[]', '[]')
      `,
    ).rejects.toThrow();
  });
});
