#!/usr/bin/env tsx
// Notion クローラー CLI。 指定トークンで DB ID 配下のページを再帰クロールし JSON 出力する。
//
// 使い方:
//   NOTION_TOKEN=secret_xxx npm run notion-crawl -- <DATABASE_ID> [options]
//   npm run notion-crawl -- <DATABASE_ID> --token secret_xxx --max-depth 3 --out data/notion
//
// options:
//   --token <t>        Notion integration token (env NOTION_TOKEN でも可)
//   --max-depth <n>    DB row から潜る深さ (既定 3)
//   --max-pages <n>    最大ページ数 (既定 500)
//   --no-child-db      child_database を辿らない
//   --out <dir>        出力ディレクトリ (既定 data/notion)
//   --stdout           ファイルに書かず標準出力へ JSON を出す

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { NotionApiClient, crawlDatabase } from '@tirocinium/notion';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

type Args = {
  databaseId: string;
  token?: string;
  maxDepth?: number;
  maxPages?: number;
  includeChildDatabases: boolean;
  out: string;
  stdout: boolean;
};

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let token: string | undefined;
  let maxDepth: number | undefined;
  let maxPages: number | undefined;
  let includeChildDatabases = true;
  let out = 'data/notion';
  let stdout = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--token': token = argv[++i]; break;
      case '--max-depth': maxDepth = Number(argv[++i]); break;
      case '--max-pages': maxPages = Number(argv[++i]); break;
      case '--no-child-db': includeChildDatabases = false; break;
      case '--out': out = argv[++i] ?? out; break;
      case '--stdout': stdout = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown option: ${a}`);
        positional.push(a);
    }
  }
  const databaseId = positional[0] ?? '';
  if (!databaseId) throw new Error('DATABASE_ID is required (1st positional arg)');
  return { databaseId, token, maxDepth, maxPages, includeChildDatabases, out, stdout };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token ?? process.env['NOTION_TOKEN'];
  if (!token) throw new Error('Notion token required: --token or NOTION_TOKEN env');

  const client = new NotionApiClient({ token, notionVersion: process.env['NOTION_VERSION'] });
  console.error(`[notion-crawl] crawling database ${args.databaseId} (maxDepth=${args.maxDepth ?? 3})`);

  const result = await crawlDatabase(client, args.databaseId, {
    maxDepth: args.maxDepth,
    maxPages: args.maxPages,
    includeChildDatabases: args.includeChildDatabases,
  });

  console.error(
    `[notion-crawl] done: ${result.pages.length} pages, ${result.errors.length} errors` +
      (result.truncated ? ' (truncated)' : ''),
  );

  const payload = JSON.stringify(result, null, 2);
  if (args.stdout) {
    process.stdout.write(payload + '\n');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(REPO_ROOT, args.out, args.databaseId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${stamp}.json`);
  await writeFile(file, payload, 'utf8');
  console.error(`[notion-crawl] written: ${file}`);
}

main().catch((err) => {
  console.error('[notion-crawl] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
