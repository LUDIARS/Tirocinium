// テストのスキーマ準備。
//   Postgres: apps/server/migrations/*.sql を名前順に 1 本ずつトランザクションで当て、_tirocinium_migrations に記録する
//             (native の tirocinium-migrate (src/app/migrate.cpp) と同じ手順。native のビルド無しで流せるように)。
//   SQLite:   apps/server/migrations-sqlite/*.sql を当てた合成の小さな DB (Node 版と同じスキーマ)。実データは開かない。

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSqlite } from '../../legacy-sqlite/sqlite.mjs';

const REPO = resolve(fileURLToPath(import.meta.url), '../../../../..');

export async function migratePostgres(sql) {
  await sql`CREATE TABLE IF NOT EXISTS _tirocinium_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
  const dir = join(REPO, 'apps/server/migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const text = readFileSync(join(dir, file), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO _tirocinium_migrations (name) VALUES (${file})`;
    });
  }
}

/** 合成の tirocinium.sqlite を作る (path に)。Node 版と同じく _tirocinium_migrations も持たせる。 */
export function createLegacyMainSqlite(path) {
  const db = openSqlite(path);
  const dir = join(REPO, 'apps/server/migrations-sqlite');
  db.exec('CREATE TABLE _tirocinium_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, file), 'utf8'));
    db.prepare("INSERT INTO _tirocinium_migrations (name, applied_at) VALUES (?, datetime('now'))").run(file);
  }
  return db;
}

/** 合成の companies.sqlite (scripts/companies-seed-import-sqlite/sqlite-store.ts と同じ表)。 */
export function createLegacyCompaniesSqlite(path) {
  const db = openSqlite(path);
  db.exec(`
CREATE TABLE companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL DEFAULT '', industry TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  roles TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]', location TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'unknown', source_url TEXT NOT NULL DEFAULT '',
  is_newgrad INTEGER NOT NULL DEFAULT 0, is_game INTEGER NOT NULL DEFAULT 0, has_opening INTEGER NOT NULL DEFAULT 0,
  recruit_url TEXT NOT NULL DEFAULT '', stock_reason TEXT NOT NULL DEFAULT '',
  crawled_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE company_profiles (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE, philosophy TEXT NOT NULL DEFAULT '',
  "values" TEXT NOT NULL DEFAULT '[]', ir_summary TEXT NOT NULL DEFAULT '', business TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '[]', fetched_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  return db;
}
