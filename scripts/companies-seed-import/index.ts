#!/usr/bin/env tsx
// 調査済みゲーム企業 seed を companies / company_profiles へ投入する CLI。
//   data/all-companies-seed.json + data/companies-research.json
//     → mapGameCompanySeed (純粋) → upsertCompany + upsertProfile (冪等)
//
// 使い方 (cwd = apps/server、 .env.local の DATABASE_URL を使用):
//   npm run companies:seed-import
//   npm run companies:seed-import -- --seed <path> --research <path>

import { importGameCompanySeeds } from '../../apps/server/src/companies/seed-import.js';
import { sql } from '../../apps/server/src/db/index.js';

type Args = { seedPath?: string; researchPath?: string };

function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === '--seed') a.seedPath = argv[++i];
    else if (t === '--research') a.researchPath = argv[++i];
    else throw new Error(`unknown option: ${t}`);
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const s = await importGameCompanySeeds(args);
    console.error(
      `[companies:seed-import] done: total=${s.total} inserted=${s.inserted} ` +
        `updated=${s.updated} profiles=${s.profiles} skipped=${s.skipped}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[companies:seed-import] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
