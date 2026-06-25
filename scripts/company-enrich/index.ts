#!/usr/bin/env tsx
// 手動用の薄いラッパ (npm run companies:enrich-chain)。 本体は src 配下の enrich-cli.ts
// (本番 dist でも子を起動できるよう src に置いてコンパイルする)。
import { runEnrichCli } from '../../apps/server/src/companies/enrich-cli.js';

runEnrichCli(process.argv.slice(2)).catch((err) => {
  console.error('[company-enrich] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
