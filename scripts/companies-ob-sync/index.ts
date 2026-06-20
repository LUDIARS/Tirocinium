#!/usr/bin/env tsx
// 非公開 Google Sheet (合格リスト) → company_ob_placement 集計同期。
// 氏名は集計に畳む過程で破棄 (個人データ境界 §2.1)。 Sheet を正本に差分 (新規/変更/削除) を反映する。
// creds / id / range は secret 経由 (TIROCINIUM_OB_SHEET_SA_JSON / _ID / _RANGE)。 env 平文に置かない。
// spec/feature/companies/game-graph.md §5.3。
//
//   npm run companies:ob-sync                       # config の Sheet を本同期
//   npm run companies:ob-sync -- --dry-run          # 差分のみ算出 (DB 反映しない)
//   npm run companies:ob-sync -- --sheet-id <id> --range 'シート1!A:E'
//   npm run companies:ob-sync -- --db <sqlite>

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { hydrateSecrets } from '../../apps/server/src/secrets/hydrate.js';
import { syncObFromSheet } from '../../apps/server/src/companies/ob-sheet-sync-wire.js';

type Args = { dryRun: boolean; sheetId?: string; range?: string; db?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--sheet-id') args.sheetId = argv[++i];
    else if (a === '--range') args.range = argv[++i];
    else if (a === '--db') args.db = argv[++i];
    else throw new Error(`unknown option: ${a}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // creds / sheet 設定を secret から注入 (失敗しても CLI 引数で上書きできるよう続行)。
  try {
    await hydrateSecrets();
  } catch {
    console.warn('[ob-sync] secret 解決に失敗 — Sheet creds が無いと同期で停止します');
  }
  // CLI 引数は secret より優先 (検証時のターゲット切替用)。
  if (args.sheetId) config.obSheet.spreadsheetId = args.sheetId;
  if (args.range) config.obSheet.range = args.range;
  if (args.db) config.databaseUrl = `sqlite:${args.db}`;
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();
  try {
    const s = await syncObFromSheet({ dryRun: args.dryRun });
    console.error(
      `[ob-sync]${s.dryRun ? ' (dry-run)' : ''} persons=${s.persons} cells=${s.cells} ` +
        `resolved=${s.resolved} unresolved=${s.unresolved} | +${s.added} ~${s.updated} -${s.removed} | ` +
        `companies=${s.companies} headcount=${s.headcount}`,
    );
    if (s.unresolvedNames.length > 0) {
      console.error(`[ob-sync] 未解決社名 (要 seed 追加 or 表記揺れ): ${s.unresolvedNames.join(' / ')}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[ob-sync] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
