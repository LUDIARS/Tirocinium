#!/usr/bin/env tsx
// 既存 games の normalized_series を埋め直す (#202 backfill)。 表記揺れ/略称/下位シリーズを
// 親シリーズキーへ畳む normalizeSeries で算出する。 決定論・冪等・LLM 不使用・token 不要。
//
//   npm run companies:series-normalize -- [--db <sqlite>]

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { backfillNormalizedSeries, countGames } from '../../apps/server/src/companies/games-repo.js';

function parseArgs(argv: string[]): void {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${a}`);
  }
}

async function main(): Promise<void> {
  parseArgs(process.argv.slice(2));
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();
  try {
    const total = await countGames();
    const updated = await backfillNormalizedSeries();
    console.error(`[series-normalize] games=${total} updated=${updated}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[series-normalize] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
