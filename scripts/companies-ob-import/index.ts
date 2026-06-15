#!/usr/bin/env tsx
// ユーザ付与の OB 就職実績 (CSV / JSON) を company_ob_placement に取り込む。
// 個人データは受け取らない (集計セル {会社名, 入社年, クラス, 役職, 人数} のみ)。
// spec/companies/game-graph.md Phase 3 / §5.3。
//
//   npm run companies:ob-import -- <file.csv|file.json>
//   npm run companies:ob-import -- <file> --db <sqlite>
//
// CSV 例 (ヘッダ必須・列順自由・未知列は無視):
//   会社名,入社年,クラス,役職,人数
//   株式会社カプコン,2024,ゲームプランナー専攻,プランナー,3
// JSON 例:
//   [{ "company": "株式会社カプコン", "join_year": 2024, "class_name": "...", "role": "プランナー", "headcount": 3 }]

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { importObFile } from '../../apps/server/src/companies/ob-import.js';

type Args = { file: string; source: string };

function parseArgs(argv: string[]): Args {
  let file = '';
  let source = 'user';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else if (argv[i] === '--source') source = argv[++i] ?? 'user';
    else if (!argv[i]!.startsWith('--')) file = argv[i]!;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  if (!file) throw new Error('usage: companies:ob-import -- <file.csv|file.json> [--source <s>] [--db <sqlite>]');
  return { file, source };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();
  try {
    const s = await importObFile(args.file, args.source);
    console.error(
      `[ob-import] cells=${s.total} upserted=${s.upserted} unresolved=${s.unresolved} | ` +
        `companies=${s.companies} headcount=${s.headcount}`,
    );
    if (s.unresolvedNames.length > 0) {
      console.error(`[ob-import] 未解決社名 (要 seed 追加 or 表記揺れ): ${s.unresolvedNames.join(' / ')}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[ob-import] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
