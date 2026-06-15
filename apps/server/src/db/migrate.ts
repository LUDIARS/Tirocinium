import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, dbBackend, initSql } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function ensureMigrationsTable() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _tirocinium_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const rows = await sql<{ name: string }[]>`SELECT name FROM _tirocinium_migrations`;
  return new Set(rows.map((r) => r.name));
}

/**
 * 未適用の migration を順に適用する。 initSql() 済を前提 (sql / dbBackend が確定していること)。
 * 他スクリプト (seed-import 等) から DB 反映前に呼べるよう export する。
 * @returns 適用した migration 数
 */
export async function runMigrations(): Promise<number> {
  // バックエンドごとに方言別の migration ディレクトリを選ぶ (initSql() 後に確定)。
  const MIGRATIONS_DIR = join(
    __dirname,
    '..',
    '..',
    dbBackend === 'sqlite' ? 'migrations-sqlite' : 'migrations',
  );

  await ensureMigrationsTable();
  const applied = await appliedSet();

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const path = join(MIGRATIONS_DIR, file);
    const text = await readFile(path, 'utf8');
    console.log(`applying ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO _tirocinium_migrations (name) VALUES (${file})`;
    });
    count++;
  }
  return count;
}

async function main() {
  // マイグレーションは DB パスのみ必要。secret-agent / ローカル config が未設定でも
  // databaseUrl 空 = SQLite デフォルト (data/tirocinium.sqlite) で続行する。
  // hydrate は secrets チェーン (@ludiars/encrypted-config) を引くため動的 import にし、
  // runMigrations を単体 import する経路 (seed-import 等) では読み込まない。
  try {
    const { hydrateSecrets } = await import('../secrets/hydrate.js');
    await hydrateSecrets();
  } catch {
    console.warn('[migrate] config not available — using default SQLite path');
  }
  initSql();
  const count = await runMigrations();
  console.log(`done. ${count} migration(s) applied.`);
  await sql.end();
}

// このファイルが直接実行されたときだけ main() を回す (import 時は実行しない)。
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
