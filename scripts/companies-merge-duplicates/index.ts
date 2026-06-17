#!/usr/bin/env tsx
// corporate_number が同じ重複企業行を 1 行にマージする CLI。
// 英語表記「Capcom Co., Ltd.」とカナ「カプコン」等、normalized_name が違う同一企業を名寄せする。
// spec/companies/game-graph.md §5.5。
//
//   npm run companies:merge-duplicates               # 実行 (DB 反映あり)
//   npm run companies:merge-duplicates -- --dry-run  # 差分のみ確認
//   npm run companies:merge-duplicates -- --db <sqlite>

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { hydrateSecrets } from '../../apps/server/src/secrets/hydrate.js';
import { mergeDuplicateCompanies } from '../../apps/server/src/companies/company-merge-wire.js';

type Args = { dryRun: boolean };

function parseArgs(argv: string[]): Args {
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${a}`);
  }
  return { dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
    await hydrateSecrets();
  } catch {
    console.warn('[merge-duplicates] secret 解決に失敗 — 既定 DB パスで続行します');
  }
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();

  try {
    if (args.dryRun) console.error('[merge-duplicates] dry-run モード (DB 反映なし)');
    const summary = await mergeDuplicateCompanies({ dryRun: args.dryRun });
    console.error(
      `[merge-duplicates] groups=${summary.groups} merged=${summary.merged}` +
        ` repointed=${summary.repointed} deleted=${summary.deleted}` +
        (summary.dryRun ? ' (dry-run)' : ''),
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[merge-duplicates] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
