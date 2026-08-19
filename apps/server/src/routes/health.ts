import { Hono } from 'hono';
import { sql } from '../db/index.js';
import { serviceVersion } from '../version.js';

/**
 * 死活エンドポイント (AIFormat RULE_SRE.md §2)。
 *
 * `ok` / `service` / `version` の 3 フィールド固定で、ハンドラは同期のまま返す。
 * DB / downstream / ファイル I/O は readiness 側に置く (health を重くしない)。
 * 正本パスは `/api/health`。`/health` は移行期の alias。
 *
 * @implements SPEC-SERVICE-RUNTIME-HEALTH
 */
export const health = new Hono();

health.get('/', (c) => c.json({ ok: true, service: 'tirocinium', version: serviceVersion() }));

/**
 * 依存 (DB) の生死。health と違い重い判定をしてよい。
 *
 * @implements SPEC-SERVICE-RUNTIME-READINESS
 */
export const readiness = new Hono();

readiness.get('/', async (c) => {
  let dbOk = false;
  try {
    const rows = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
    dbOk = rows[0]?.ok === 1;
  } catch {
    dbOk = false;
  }
  return c.json({ ok: dbOk, service: 'tirocinium', version: serviceVersion(), db: dbOk }, dbOk ? 200 : 503);
});
