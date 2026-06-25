#!/usr/bin/env tsx
// 子クローラ (CLI)。 crawl-queue worker から detached spawn される。 cli backend (claude -p) で
// 1 社をフルチェーン enrich する (works→ゲーム紐付け + recruit-page 求人 + 企業情報)。
//
//   npm run companies:enrich-chain -- --company-id <uuid> [--job-id <uuid>] [--db <sqlite>]
//
// --job-id があれば crawl_jobs.child_status を running→done/failed に更新する (Web 側の可視化用)。

import { config } from '../../apps/server/src/config.js';
import { initSql, sql } from '../../apps/server/src/db/index.js';
import { runMigrations } from '../../apps/server/src/db/migrate.js';
import { runCompanyEnrichChain } from '../../apps/server/src/companies/enrich-chain.js';
import { markChildResult } from '../../apps/server/src/companies/crawl-queue-repo.js';

type Args = { companyId: string; jobId: string };

function parseArgs(argv: string[]): Args {
  const a: Args = { companyId: '', jobId: '' };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === '--company-id') a.companyId = argv[++i] ?? '';
    else if (t === '--job-id') a.jobId = argv[++i] ?? '';
    else if (t === '--db') config.databaseUrl = `sqlite:${argv[++i]}`;
    else throw new Error(`unknown option: ${t}`);
  }
  if (!a.companyId) throw new Error('--company-id は必須です');
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // 子は常に cli backend (claude -p、 鍵不要)。 Web 本体の backend に依存しない。
  config.llmBackend = 'cli';
  if (!config.databaseUrl && process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];

  initSql();
  await runMigrations();

  if (args.jobId) await markChildResult(args.jobId, 'running', '').catch(() => {});
  try {
    const s = await runCompanyEnrichChain(args.companyId);
    const detail =
      `${s.companyName}: works=${s.discovered.works} career=${s.discovered.career} ` +
      `games=${s.contribute?.games ?? 0} jobs=${s.jobs?.inserted ?? 0} errors=${s.errors.length}`;
    console.error(`[company-enrich] ${detail}`);
    console.error(`[company-enrich] summary: ${JSON.stringify(s)}`);
    if (args.jobId) await markChildResult(args.jobId, 'done', detail).catch(() => {});
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[company-enrich] failed: ${msg}`);
    if (args.jobId) await markChildResult(args.jobId, 'failed', msg).catch(() => {});
    throw err;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[company-enrich] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
