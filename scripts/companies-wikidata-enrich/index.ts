#!/usr/bin/env tsx
// 既知企業を起点に Wikidata からゲーム/共演企業/シリーズ/取引先を投入する発見クロール CLI。
// spec/companies/game-graph.md Phase2。 公開オープンデータ・LLM 不使用。
//
//   npm run companies:wikidata-enrich
//   npm run companies:wikidata-enrich -- --db <sqlite> --limit 50 --interval 300

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { runWikidataEnrich } from '../../apps/server/src/companies/wikidata-enrich.js';

function parseArgs(argv: string[]): { limit?: number; interval?: number } {
  const a: { limit?: number; interval?: number } = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === '--limit') a.limit = Number.parseInt(argv[++i]!, 10);
    else if (t === '--interval') a.interval = Number.parseInt(argv[++i]!, 10);
    else if (t === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${t}`);
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();
  try {
    const s = await runWikidataEnrich({ limit: args.limit, minIntervalMs: args.interval });
    console.error(
      `[wikidata-enrich] done: scanned=${s.companiesScanned} games=${s.gamesUpserted} ` +
        `newCompanies=${s.newCompanies} gameEdges=${s.gameEdges} partnerEdges=${s.partnerEdges} ` +
        `series=${s.seriesTagged} errors=${s.errors.length}`,
    );
    if (s.errors.length) console.error('  first errors:', s.errors.slice(0, 5));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[wikidata-enrich] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
