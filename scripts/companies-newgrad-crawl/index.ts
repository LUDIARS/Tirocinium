#!/usr/bin/env tsx
// 新卒採用者インタビュー記事を (1社最大100) クロール保存し、 求める新卒像を要約する CLI。
//   seed URL は data/companies-research.json の interview_urls (社名で DB の company に紐付け)。
//
// 使い方 (cwd = apps/server、 .env.local の DATABASE_URL / LLM backend を使用):
//   npm run companies:newgrad-crawl                  # 全社 (seed 有り)
//   npm run companies:newgrad-crawl -- --limit 3     # 先頭3社だけ (動作確認)
//   npm run companies:newgrad-crawl -- --company ネコノメ --max 20
//   npm run companies:newgrad-crawl -- --max 50      # 1社あたり最大記事数

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from '@tirocinium/companies';
import { config } from '../../apps/server/src/config.js';
import { PoliteFetcher } from '../../apps/server/src/companies/fetcher.js';
import { allCompaniesForScoring } from '../../apps/server/src/companies/repo.js';
import { createCompleter } from '../../apps/server/src/companies/llm-completer.js';
import { crawlAndSummarizeNewgrad } from '../../apps/server/src/companies/newgrad.js';
import { sql } from '../../apps/server/src/db/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Args = { limit?: number; max: number; company?: string };
function parseArgs(argv: string[]): Args {
  const a: Args = { max: 100 };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === '--limit') a.limit = Number(argv[++i]);
    else if (t === '--max') a.max = Number(argv[++i]);
    else if (t === '--company') a.company = argv[++i];
    else throw new Error(`unknown option: ${t}`);
  }
  return a;
}

type Research = { name?: string; interview_urls?: string[] };

function loadSeedMap(): Map<string, string[]> {
  const path = join(REPO_ROOT, 'data', 'companies-research.json');
  const map = new Map<string, string[]>();
  try {
    const arr = JSON.parse(readFileSync(path, 'utf8')) as Research[];
    for (const r of arr) {
      if (r.name && Array.isArray(r.interview_urls) && r.interview_urls.length > 0) {
        map.set(normalizeName(r.name), r.interview_urls.filter((u) => typeof u === 'string'));
      }
    }
  } catch (err) {
    throw new Error(`research.json を読めません: ${(err as Error).message}`);
  }
  return map;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const seedMap = loadSeedMap();

  let companies = await allCompaniesForScoring(2000);
  if (args.company) {
    const key = normalizeName(args.company);
    companies = companies.filter((c) => c.normalized_name === key);
  }
  // seed URL を持つ会社のみ対象。
  companies = companies.filter((c) => (seedMap.get(c.normalized_name)?.length ?? 0) > 0);
  if (args.limit) companies = companies.slice(0, args.limit);

  console.error(
    `[newgrad-crawl] 対象 ${companies.length} 社 / 1社最大 ${args.max} 記事 / backend=${config.llmBackend}`,
  );

  const fetcher = new PoliteFetcher({
    userAgent: config.companyCrawl.userAgent,
    fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
    minIntervalMs: config.companyCrawl.minIntervalMs,
    respectRobots: config.companyCrawl.respectRobots,
  });
  const { complete, modelLabel } = createCompleter('SUMMARIZER');

  const tally = { companies: 0, articles: 0, summarized: 0, errors: 0 };
  try {
    for (const c of companies) {
      const seedUrls = seedMap.get(c.normalized_name) ?? [];
      const r = await crawlAndSummarizeNewgrad({
        company: c,
        seedUrls,
        maxArticles: args.max,
        fetcher,
        completer: complete,
        modelLabel,
      });
      tally.companies++;
      tally.articles += r.articlesStored;
      if (r.summarized) tally.summarized++;
      if (r.error) tally.errors++;
      console.error(
        `  - ${r.company}: articles=${r.articlesStored} pages=${r.pagesFetched} ` +
          `robots=${r.robotsBlocked} summarized=${r.summarized}${r.error ? ` error=${r.error}` : ''}`,
      );
    }
  } finally {
    await sql.end();
  }

  console.error(
    `[newgrad-crawl] done: companies=${tally.companies} articles=${tally.articles} ` +
      `summarized=${tally.summarized} errors=${tally.errors}`,
  );
}

main().catch((err) => {
  console.error('[newgrad-crawl] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
