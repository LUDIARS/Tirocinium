// patchSessionMetadata の裏取り (repo.test.ts / crawl-queue-repo.test.ts と同じ実 SQL 経路パターン)。
// 旧実装の `metadata = metadata || sql.json(patch)` は SQLite (TEXT 列) では文字列連結になり
// 不正 JSON を生む — ここでは複数回パッチしても常に有効な JSON object であることを検証する。

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { config } from '../config.js';
import { initSql, sql } from './index.js';
import { runMigrations } from './migrate.js';
import { patchSessionMetadata } from './session-metadata.js';

const dbPath = join(tmpdir(), `tr-session-metadata-${randomUUID()}.sqlite`);
let sessionId = '';

beforeAll(async () => {
  config.databaseUrl = dbPath;
  initSql();
  await runMigrations();
  await sql`INSERT INTO users (id) VALUES ('u1')`;
  await sql`
    INSERT INTO sessions (user_id, mode, status)
    VALUES ('u1', 'server', 'active')
  `;
  const rows = await sql<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = 'u1'`;
  sessionId = rows[0]!.id;
});

afterAll(async () => {
  await sql.end();
  for (const suffix of ['', '-shm', '-wal']) {
    try { rmSync(dbPath + suffix); } catch { /* noop */ }
  }
});

async function readMetadata(): Promise<Record<string, unknown>> {
  const rows = await sql<{ metadata: unknown }[]>`SELECT metadata FROM sessions WHERE id = ${sessionId}`;
  const raw = rows[0]!.metadata;
  return typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
}

describe('patchSessionMetadata', () => {
  it('初回パッチは既定の {} にマージされる', async () => {
    await patchSessionMetadata(sessionId, { interviewer_id: 'p1' });
    expect(await readMetadata()).toEqual({ interviewer_id: 'p1' });
  });

  it('複数回パッチしても常に有効な JSON object のまま (文字列連結による破損が無い)', async () => {
    await patchSessionMetadata(sessionId, { session_seed: 42 });
    await patchSessionMetadata(sessionId, { phase_progress: { phase: 'probe' } });
    const meta = await readMetadata();
    // 既存キーが保持されつつ (浅いマージ)、新しいキーが追加されていること
    expect(meta).toEqual({
      interviewer_id: 'p1',
      session_seed: 42,
      phase_progress: { phase: 'probe' },
    });
  });

  it('同名キーは新しい値で上書きされる (浅いマージ)', async () => {
    await patchSessionMetadata(sessionId, { interviewer_id: 'p2' });
    const meta = await readMetadata();
    expect(meta['interviewer_id']).toBe('p2');
  });
});
