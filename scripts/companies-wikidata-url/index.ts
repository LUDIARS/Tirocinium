#!/usr/bin/env tsx
// Wikidata 発見社 (url 未取得) の公式HP を Wikidata の official website (P856) で埋める。
// 決定論・公開オープンデータ (LLM 不使用・token 不要)。 game-graph §0 / 名寄れ補完。
//
//   npm run companies:wikidata-url -- [--limit 50] [--interval 300] [--db <sqlite>]

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { companiesNeedingUrlFromWikidata, updateCompanyInfo } from '../../apps/server/src/companies/repo.js';
import { fetchOfficialSite } from '../../apps/server/src/companies/wikidata.js';
import { runWikidataUrlFill, type WikidataUrlDeps } from '../../apps/server/src/companies/wikidata-url.js';

type Args = { limit: number; interval: number };

function parseArgs(argv: string[]): Args {
  let limit = 50;
  let interval = 300;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') limit = Number.parseInt(argv[++i] ?? '50', 10) || 50;
    else if (a === '--interval') interval = Number.parseInt(argv[++i] ?? '300', 10) || 300;
    else if (a === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${a}`);
  }
  return { limit, interval };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();

  const deps: WikidataUrlDeps = {
    loadTargets: (limit) => companiesNeedingUrlFromWikidata(limit),
    resolveSite: (label) => fetchOfficialSite(label),
    applyUrl: (id, url) => updateCompanyInfo(id, { url }),
  };

  try {
    const s = await runWikidataUrlFill(deps, { limit: args.limit, minIntervalMs: args.interval });
    console.error(
      `[wikidata-url] targets=${s.targets} filled=${s.filled} notFound=${s.notFound} errors=${s.errors.length}`,
    );
    for (const e of s.errors.slice(0, 10)) console.error(`  ✗ ${e.company}: ${e.message}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[wikidata-url] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
