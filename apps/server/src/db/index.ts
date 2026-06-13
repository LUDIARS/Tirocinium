import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { config } from '../config.js';
import { createSqliteSql } from './sqlite-driver.js';

// __dirname = apps/server/src/db → プロジェクトルートは 4 階層上
const _dir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(_dir, '../../../..');

// --- 遅延初期化 ---
// DB 接続は initSql() が呼ばれるまで作成しない。
// hydrateSecrets() で config.databaseUrl が確定した後、 index.ts から呼ぶ。

let _impl: Sql | null = null;

/** DATABASE_URL が postgres:// 以外 (空 / sqlite: / file: / *.sqlite|*.db) なら SQLite。 */
export let isSqlite = true;
export let dbBackend: 'sqlite' | 'postgres' = 'sqlite';

function sqlitePath(u: string): string {
  if (!u) return resolve(PROJECT_ROOT, 'data', 'tirocinium.sqlite');
  const p = u
    .replace(/^sqlite:\/\//, '')
    .replace(/^sqlite:/, '')
    .replace(/^file:\/\//, '')
    .replace(/^file:/, '');
  // 絶対パスはそのまま、相対パスはプロジェクトルート基準
  return resolve(PROJECT_ROOT, p);
}

/** hydrateSecrets() の後に呼ぶ。 config.databaseUrl を読んで DB 接続を確立する。 */
export function initSql(): void {
  const url = config.databaseUrl;
  isSqlite =
    !url ||
    url.startsWith('sqlite:') ||
    url.startsWith('file:') ||
    url.endsWith('.sqlite') ||
    url.endsWith('.db');
  dbBackend = isSqlite ? 'sqlite' : 'postgres';
  _impl = isSqlite
    ? (createSqliteSql(sqlitePath(url)) as unknown as Sql)
    : postgres(url, { max: 10, idle_timeout: 30, prepare: false });
}

function getImpl(): Sql {
  if (!_impl) throw new Error('DB not initialized — call initSql() after hydrateSecrets()');
  return _impl;
}

// 型は postgres の Sql に統一 (既存 21 ファイルの呼び出しをそのまま通す)。
// タグ付きテンプレート + メソッド群を実体に委譲する遅延ラッパー。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sqlWrapper = ((...args: any[]) => (getImpl() as any)(...args)) as unknown as Sql;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(sqlWrapper as any).json = (...args: any[]) => (getImpl() as any).json(...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(sqlWrapper as any).unsafe = (...args: any[]) => (getImpl() as any).unsafe(...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(sqlWrapper as any).begin = (...args: any[]) => (getImpl() as any).begin(...args);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(sqlWrapper as any).end = (...args: any[]) => (getImpl() as any).end(...args);

export const sql: Sql = sqlWrapper;

export type { Sql };
