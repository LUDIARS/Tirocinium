import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { config } from '../config.js';
import { createSqliteSql } from './sqlite-driver.js';

const url = config.databaseUrl;

/** DATABASE_URL が postgres:// 以外 (空 / sqlite: / file: / *.sqlite|*.db) なら SQLite。 */
export const isSqlite =
  !url ||
  url.startsWith('sqlite:') ||
  url.startsWith('file:') ||
  url.endsWith('.sqlite') ||
  url.endsWith('.db');

export const dbBackend: 'sqlite' | 'postgres' = isSqlite ? 'sqlite' : 'postgres';

function sqlitePath(u: string): string {
  if (!u) return resolve(process.cwd(), 'data', 'tirocinium.sqlite');
  const p = u
    .replace(/^sqlite:\/\//, '')
    .replace(/^sqlite:/, '')
    .replace(/^file:\/\//, '')
    .replace(/^file:/, '');
  return resolve(process.cwd(), p);
}

// 型は postgres の Sql に統一 (既存 21 ファイルの呼び出しをそのまま通す)。
// SQLite 時は互換 shim を Sql に as-cast する (runtime は shim、 型は postgres)。
export const sql: Sql = isSqlite
  ? (createSqliteSql(sqlitePath(url)) as unknown as Sql)
  : postgres(url, { max: 10, idle_timeout: 30, prepare: false });

export type { Sql };
