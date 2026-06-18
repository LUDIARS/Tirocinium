// 実 SQLite に対して backdoor-repo を実走させる (fake DB ではなく実 SQL 経路を裏取りする)。
// migration 019 の DDL・列名・bool 0/1 正規化・token 期限判定をまとめて検証する。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { config } from '../config.js';
import { initSql, sql } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import {
  issueLinkToken,
  exchangeLinkToken,
  verifySession,
  getEntry,
  upsertEntry,
  deleteEntry,
  listStudentMessages,
  listIndustryMessages,
} from './backdoor-repo.js';

const dbPath = join(tmpdir(), `tr-backdoor-${randomUUID()}.sqlite`);

beforeAll(async () => {
  config.databaseUrl = dbPath; // 拡張子 .sqlite なので SQLite として初期化される
  initSql();
  await runMigrations();
});

afterAll(async () => {
  await sql.end();
  for (const suffix of ['', '-shm', '-wal']) {
    try { rmSync(dbPath + suffix); } catch { /* noop */ }
  }
});

describe('backdoor-repo (real sqlite)', () => {
  it('link token を発行し session に交換できる (再利用は不可)', async () => {
    const link = await issueLinkToken('u1', 'Alice', 15);
    const result = await exchangeLinkToken(link, 720);
    expect(result).not.toBeNull();
    expect(result!.entry.discord_user_id).toBe('u1');
    expect(result!.entry.display_name).toBe('Alice');

    const session = await verifySession(result!.session);
    expect(session).toEqual({ discordUserId: 'u1', displayName: 'Alice' });

    // 同じ link token は used_at で再利用不可
    const again = await exchangeLinkToken(link, 720);
    expect(again).toBeNull();
  });

  it('期限切れ link token は交換できない', async () => {
    const link = await issueLinkToken('u-exp', 'Old', -1); // 既に期限切れ
    expect(await exchangeLinkToken(link, 720)).toBeNull();
  });

  it('不正な session token は弾く', async () => {
    expect(await verifySession('deadbeef')).toBeNull();
  });

  it('部分更新で既存フィールドを維持し、 publish フラグが list に反映される', async () => {
    await upsertEntry('u2', 'Bob', {
      current_company: 'Acme',
      message_to_students: 'hi students',
      students_published: true,
    });
    // 別パッチで industry を足しても students 側は保持される
    await upsertEntry('u2', 'Bob', {
      message_to_industry: 'hi industry',
      industry_published: true,
    });

    const entry = await getEntry('u2');
    expect(entry).not.toBeNull();
    expect(entry!.current_company).toBe('Acme');
    expect(entry!.message_to_students).toBe('hi students');
    expect(entry!.students_published).toBe(true);
    expect(entry!.message_to_industry).toBe('hi industry');
    expect(entry!.industry_published).toBe(true);
    // 未解決社名は current_company_id null
    expect(entry!.current_company_id).toBeNull();

    const students = await listStudentMessages();
    expect(students.some((e) => e.discord_user_id === 'u2')).toBe(true);
    const industry = await listIndustryMessages();
    expect(industry.some((e) => e.discord_user_id === 'u2')).toBe(true);

    // 取り下げると学生向け list から消える
    await upsertEntry('u2', 'Bob', { students_published: false });
    const students2 = await listStudentMessages();
    expect(students2.some((e) => e.discord_user_id === 'u2')).toBe(false);
  });

  it('本文が空のエントリは published でも list に出さない', async () => {
    await upsertEntry('u3', 'Empty', { students_published: true, industry_published: true });
    const students = await listStudentMessages();
    const industry = await listIndustryMessages();
    expect(students.some((e) => e.discord_user_id === 'u3')).toBe(false);
    expect(industry.some((e) => e.discord_user_id === 'u3')).toBe(false);
  });

  it('本人がエントリを削除できる', async () => {
    await upsertEntry('u4', 'Carol', { current_company: 'Beta' });
    expect(await getEntry('u4')).not.toBeNull();
    await deleteEntry('u4');
    expect(await getEntry('u4')).toBeNull();
  });
});
