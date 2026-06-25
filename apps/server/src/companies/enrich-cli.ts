// 子クローラ (CLI) の本体。 src 配下に置き dist にもコンパイルされる
// (本番 `node dist` でも子を起動できるようにするため)。
// dev は tsx で .ts を、 本番は node で .js を直接実行する (child-enrich-spawn.ts が選ぶ)。
//
//   node  dist/companies/enrich-cli.js --company-id <uuid> [--job-id <uuid>] [--db <sqlite>]
//   tsx   src/companies/enrich-cli.ts  --company-id <uuid> ...
//
// --job-id があれば crawl_jobs.child_status を running→done/failed に更新する (可視化用)。

import { config } from '../config.js';
import { initSql, sql } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { runCompanyEnrichChain } from './enrich-chain.js';
import { markChildResult } from './crawl-queue-repo.js';

type CliArgs = { companyId: string; jobId: string };

function parseArgs(argv: string[]): CliArgs {
  const a: CliArgs = { companyId: '', jobId: '' };
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

/** 子クローラのエントリ。 1 社をフルチェーン enrich する (cli backend 固定)。 */
export async function runEnrichCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
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

// 直接実行されたとき (node dist/...enrich-cli.js / tsx ...enrich-cli.ts) だけ走らせる。
// 他モジュールから import されただけでは実行しない (argv[1] で判定)。
const invoked = process.argv[1] ?? '';
if (/enrich-cli\.(js|ts)$/.test(invoked)) {
  runEnrichCli(process.argv.slice(2)).catch((err) => {
    console.error('[company-enrich] error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
