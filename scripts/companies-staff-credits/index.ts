#!/usr/bin/env tsx
// スタッフロール発見クロール (#200)。 クレジット掲載元から Game↔企業 (dev/pub/support/credited) を
// 発見し、 未知企業は source='staff-credits' で自動登録する。 決定論パース・LLM 不使用・token 不要。
// ソースは ToS 要確認のため既定 disabled。 opt-in (COMPANY_LISTING_OPTIN_SOURCES) で有効化する。
//
//   npm run companies:staff-credits -- [--source <id>] [--db <sqlite>]

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { runStaffCreditsCrawl } from '../../apps/server/src/companies/staff-credits-crawl.js';

type Args = { sourceId?: string };

function parseArgs(argv: string[]): Args {
  let sourceId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') sourceId = argv[++i];
    else if (a === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${a}`);
  }
  return { sourceId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();
  try {
    const s = await runStaffCreditsCrawl(args.sourceId);
    if (s.sources.length === 0) {
      console.error('[staff-credits] 有効な staff-credits ソースがありません (ToS 確認後 listing-sources.json で enabled または COMPANY_LISTING_OPTIN_SOURCES で opt-in)');
    }
    console.error(
      `[staff-credits] sources=${s.sources.join(',') || '-'} games=${s.games} edges=${s.edges} ` +
        `newCompanies=${s.newCompanies} robotsBlocked=${s.robotsBlocked} errors=${s.errors.length}`,
    );
    for (const e of s.errors.slice(0, 10)) console.error(`  ✗ ${e.url}: ${e.message}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[staff-credits] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
