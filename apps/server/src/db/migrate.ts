import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function ensureMigrationsTable() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _tirocinium_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const rows = await sql<{ name: string }[]>`SELECT name FROM _tirocinium_migrations`;
  return new Set(rows.map((r) => r.name));
}

async function main() {
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

  console.log(`done. ${count} migration(s) applied.`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
