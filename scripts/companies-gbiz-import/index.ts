#!/usr/bin/env tsx
// gBizINFO (経産省 法人情報 API) で companies 母集団を粗く埋める (中小レーン)。
// 取得は公開オープンデータ・決定論 (LLM 不使用)。 ゲーム/募集の確定は別途 HP裏取り (enrich)。
// spec/companies/gbizinfo.md §4。
//
//   npm run companies:gbiz-import -- --industry <code> [--name ゲーム] [--prefecture 東京都] [--max 100]
//   npm run companies:gbiz-import -- --name カプコン --db <sqlite>
//
// token は secret 経由 (GBIZINFO_TOKEN)。 env 平文には置かない (config-setup / secret-agent)。

import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { hydrateSecrets } from '../../apps/server/src/secrets/hydrate.js';
import { runGBizImport } from '../../apps/server/src/companies/gbiz-import.js';
import type { GBizQuery } from '../../apps/server/src/companies/gbizinfo.js';

type Args = { query: GBizQuery; max: number };

function parseArgs(argv: string[]): Args {
  const query: GBizQuery = {};
  let max = 100;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--industry') query.industry = argv[++i];
    else if (a === '--name') query.name = argv[++i];
    else if (a === '--prefecture') query.prefecture = argv[++i];
    else if (a === '--max') max = Number.parseInt(argv[++i] ?? '100', 10) || 100;
    else if (a === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${a}`);
  }
  if (!query.name && !query.industry && !query.prefecture) {
    throw new Error('usage: companies:gbiz-import -- (--industry <code> | --name <kw> | --prefecture <pref>) [--max <n>] [--db <sqlite>]');
  }
  return { query, max };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // token / 既定業種を secret から注入 (失敗してもデフォルトで続行)。
  try {
    await hydrateSecrets();
  } catch {
    console.warn('[gbiz-import] secret 解決に失敗 — GBIZINFO_TOKEN が無いと API 呼び出しで停止します');
  }
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
  initSql();
  await runMigrations();
  try {
    const s = await runGBizImport({ query: args.query, max: args.max });
    console.error(
      `[gbiz-import] discovered=${s.discovered} inserted=${s.inserted} updated=${s.updated} skipped=${s.skipped} | ` +
        `法人番号付=${s.withCorpNumber} HP有=${s.withUrl} 従業員数有=${s.withEmployees}`,
    );
    if (s.discovered > 0 && s.withUrl / s.discovered < 0.5) {
      console.error(`[gbiz-import] ⚠ company_url 充足率 ${Math.round((s.withUrl / s.discovered) * 100)}% — 社名→HP特定ステップの比率が上がる (spec §0)`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[gbiz-import] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
