#!/usr/bin/env tsx
// IR / 会社情報ページをクロールして従業員数 (employee_count) を裏取りする (game-graph §5.4 Phase4)。
// 対象は employee_count=0 の上場社 / research 名寄れ失敗社。 抽出は決定論 (LLM 不使用・token 不要)。
//
//   npm run companies:ir-employee -- [--limit 20] [--company <id>] [--db <sqlite>]
//
// 例: npm run companies:ir-employee -- --limit 50
//     npm run companies:ir-employee -- --company <uuid>

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { runIrEmployeeCrawl } from '../../apps/server/src/companies/ir-employee.js';

type Args = { limit: number; companyId?: string };

function parseArgs(argv: string[]): Args {
  let limit = 20;
  let companyId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') limit = Number.parseInt(argv[++i] ?? '20', 10) || 20;
    else if (a === '--company') companyId = argv[++i];
    else if (a === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${a}`);
  }
  return { limit, companyId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();
  try {
    const s = await runIrEmployeeCrawl({ limit: args.limit, companyId: args.companyId });
    console.error(
      `[ir-employee] targets=${s.targets} resolved=${s.resolved} unresolved=${s.unresolved} ` +
        `pages=${s.pagesFetched} robotsBlocked=${s.robotsBlocked} errors=${s.errors.length}`,
    );
    for (const e of s.errors.slice(0, 10)) console.error(`  ✗ ${e.company}: ${e.message}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[ir-employee] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
