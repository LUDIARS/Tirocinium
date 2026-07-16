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
});
