#!/usr/bin/env tsx
// 調査済みゲーム企業 seed を companies / company_profiles (アプリ DB) へ投入する CLI。
//   data/all-companies-seed.json + data/companies-research.json
//     → mapGameCompanySeed (純粋) → upsertCompany + upsertProfile (冪等)
//
// 起動時に initSql() + migration を自走するため、 secret-agent 無し・DB 単体で反映できる。
// 既定 DB は SQLite (data/tirocinium.sqlite)。 DATABASE_URL / --db で上書き可。
//
// 使い方:
//   npm run companies:seed-import
//   npm run companies:seed-import -- --seed data/honne-seed.json        # 追加 seed を上乗せ
//   npm run companies:seed-import -- --seed a.json --seed b.json        # 複数指定可
//   npm run companies:seed-import -- --research <path> --db <sqlite path>

import { importGameCompanySeeds } from '../../apps/server/src/companies/seed-import.js';
import { config } from '../../apps/server/src/config.js';
import { sql, initSql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';

type Args = { seedPaths: string[]; researchPath?: string };

function parseArgs(argv: string[]): Args {
  const a: Args = { seedPaths: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === '--seed') a.seedPaths.push(argv[++i]!);
    else if (t === '--research') a.researchPath = argv[++i];
    else if (t === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${t}`);
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // DATABASE_URL があれば優先、 無ければ既定 SQLite (initSql 内で data/tirocinium.sqlite)。
  if (!config.databaseUrl && process.env['DATABASE_URL']) {
    config.databaseUrl = process.env['DATABASE_URL'];
  }
  initSql();
  const applied = await runMigrations();
  console.error(`[companies:seed-import] migrations applied: ${applied}`);

  try {
    // --seed 未指定なら既定 seed のみ。 指定があれば「既定 → 各 --seed」を順に上乗せ (冪等 upsert)。
    const runs = args.seedPaths.length > 0 ? [undefined, ...args.seedPaths] : [undefined];
    const grand = { total: 0, inserted: 0, updated: 0, profiles: 0, skipped: 0 };
    for (const seedPath of runs) {
      const s = await importGameCompanySeeds({ seedPath, researchPath: args.researchPath });
      grand.total += s.total;
      grand.inserted += s.inserted;
      grand.updated += s.updated;
      grand.profiles += s.profiles;
      grand.skipped += s.skipped;
      console.error(
        `[companies:seed-import]  ${seedPath ?? '(default seed)'}: total=${s.total} ` +
          `inserted=${s.inserted} updated=${s.updated} profiles=${s.profiles} skipped=${s.skipped}`,
      );
    }
    console.error(
      `[companies:seed-import] done: total=${grand.total} inserted=${grand.inserted} ` +
        `updated=${grand.updated} profiles=${grand.profiles} skipped=${grand.skipped}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[companies:seed-import] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
