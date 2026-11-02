// 企業クロールの worker (Node のまま残す部分)。C++ サーバ (native/ の tirocinium-server) が子プロセスとして
// 起動し、標準入出力の 1 行 JSON でやり取りする。外から接続を受ける口 (HTTP/WS) は持たない。
//
// Node に残す理由: 企業ページ・RSS/Atom の HTML/XML 解析、Notion のブラウザ操作 (@ludiars/canalis)、
// LLM 抽出 (SDK) を含むため (共通規約: 複雑な外部形式のパーサーを C++ で自作しない)。
// native/PORTING.md「人間の判断が要ること」を参照。
//
// 要求:  {"id": 1, "op": "listing-crawl", "args": {...}}
// 応答:  @@tr-worker@@ {"id": 1, "ok": true, "result": ...}  /  {"id": 1, "ok": false, "error": "..."}
// 標準出力の他の行 (ライブラリのログ) は C++ 側が読み捨てる。ログは標準エラーへ出す。

/* eslint-disable no-console */
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const { config } = await import('../config.js');
const { hydrateSecrets } = await import('../secrets/hydrate.js');
const { initSql } = await import('../db/index.js');

await hydrateSecrets();
// C++ サーバと同じ Postgres を使う (Node 版の常駐サーバは常に SQLite だった)。
if (process.env['DATABASE_URL']) config.databaseUrl = process.env['DATABASE_URL'];
initSql();

const { runListingCrawl } = await import('../companies/listing-crawler.js');
const { runJobNewsCrawl } = await import('../companies/job-news-crawler.js');
const { runContribute } = await import('../companies/contribute.js');
const { runEnrichment } = await import('../companies/enrich.js');
const { mergeDuplicateCompanies } = await import('../companies/company-merge-wire.js');
const { syncObFromSheet } = await import('../companies/ob-sheet-sync-wire.js');
const { researchCompanyAi } = await import('../companies/interview-research.js');
const { startEnrichQueue, stopEnrichQueue, enrichQueueStatus } = await import('../companies/enrich-queue.js');
const { startCrawlQueue, stopCrawlQueue, crawlQueueStatus } = await import('../companies/crawl-queue.js');
const { startJobNewsQueue, stopJobNewsQueue } = await import('../companies/job-news-queue.js');
const { topObStudios } = await import('../companies/ob-repo.js');

type Args = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const ops: Record<string, (a: Args) => Promise<unknown>> = {
  'listing-crawl': (a) => runListingCrawl(str(a['source'])),
  'job-news-crawl': (a) => runJobNewsCrawl(str(a['source'])),
  contribute: (a) => runContribute(String(a['companyId'] ?? ''), Array.isArray(a['links']) ? (a['links'] as string[]) : []),
  enrich: (a) => runEnrichment({ companyId: str(a['companyId']), limit: num(a['limit']) }),
  'merge-duplicates': (a) => mergeDuplicateCompanies({ dryRun: a['dryRun'] === true }),
  'ob-sync': (a) => syncObFromSheet({ dryRun: a['dryRun'] === true }),
  'ai-research': (a) => researchCompanyAi(String(a['companyUrl'] ?? ''), Array.isArray(a['profileUrls']) ? (a['profileUrls'] as string[]) : []),
  'crawl-queue-status': () => crawlQueueStatus(),
  'enrich-queue-status': () => enrichQueueStatus(),
  'ob-studios': (a) => topObStudios(num(a['limit']), num(a['games'])),
};

function reply(msg: unknown): void {
  process.stdout.write(`@@tr-worker@@ ${JSON.stringify(msg)}\n`);
}

startEnrichQueue();
startCrawlQueue();
startJobNewsQueue();

const { createInterface } = await import('node:readline');
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  let req: { id?: unknown; op?: unknown; args?: unknown };
  try {
    req = JSON.parse(line) as typeof req;
  } catch {
    return;
  }
  const id = req.id;
  const op = typeof req.op === 'string' ? ops[req.op] : undefined;
  if (!op) {
    reply({ id, ok: false, error: 'unknown_op' });
    return;
  }
  op((req.args && typeof req.args === 'object' ? req.args : {}) as Args)
    .then((result) => reply({ id, ok: true, result: result ?? null }))
    .catch((err: unknown) => reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) }));
});
rl.on('close', () => {
  // 親 (C++ サーバ) が終わったら一緒に終わる。
  stopEnrichQueue();
  stopCrawlQueue();
  stopJobNewsQueue();
  process.exit(0);
});
