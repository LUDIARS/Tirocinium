#!/usr/bin/env tsx
// 既存タグから技術グラフを構築 + ゲーム機種から会社のソシャゲ/プラットフォーム傾向を分類する。
// 決定論・無コスト (採用ページからの技術 enrich は companies:enrich が担当)。
//
//   npm run companies:tech-build
//   npm run companies:tech-build -- --db <sqlite>

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { buildTechFromTags, classifyCompanyPlatforms, countTech } from '../../apps/server/src/companies/tech-repo.js';

function parseArgs(argv: string[]): void {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
}

async function main(): Promise<void> {
  parseArgs(process.argv.slice(2));
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();
  try {
    const tech = await buildTechFromTags();
    const plat = await classifyCompanyPlatforms();
    const total = await countTech();
    console.error(
      `[tech-build] tags→tech: companies=${tech.companies} edges=${tech.edges} | ` +
        `platform分類: classified=${plat.classified} social=${plat.social} | ` +
        `tech nodes=${total.tech} company_tech=${total.edges}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[tech-build] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
