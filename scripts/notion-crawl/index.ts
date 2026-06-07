#!/usr/bin/env tsx
// Notion クローラー CLI。 DB ID 配下のページを再帰クロールし JSON 出力する。
//
// 設定 (Notion token / DB ID / オプション) は **Excubitor secret-agent から取得** する
// (env は使わない)。 service code (既定 'tirocinium') の Infisical マッピングに
// NOTION_TOKEN / NOTION_DATABASE_ID / NOTION_* を入れておく。
//
// 使い方:
//   npm run notion-crawl                      # 全て agent から (NOTION_DATABASE_ID 含む)
//   npm run notion-crawl -- <DATABASE_ID>     # DB ID だけ明示 (token は agent)
//   npm run notion-crawl -- --token secret_x <DATABASE_ID>   # token も明示 (agent 不使用)
//
// options:
//   --service <code>   secret-agent の service code (既定 'tirocinium')
//   --token <t>        Notion token を明示 (指定時 agent を引かない)
//   --max-depth <n> / --max-pages <n> / --no-child-db
//   --out <dir> (既定 data/notion) / --stdout

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotionApiClient, crawlDatabase } from '@tirocinium/notion';
import { resolveSecrets, SecretAgentError } from '@tirocinium/secrets';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

// agent / Infisical から拾う設定キー。
const SECRET_KEYS = [
  'NOTION_TOKEN',
  'NOTION_DATABASE_ID',
  'NOTION_VERSION',
  'NOTION_MIN_INTERVAL_MS',
  'NOTION_MAX_DEPTH',
  'NOTION_MAX_PAGES',
  'NOTION_INCLUDE_CHILD_DB',
];

type Args = {
  databaseId?: string;
  service: string;
  token?: string;
  maxDepth?: number;
  maxPages?: number;
  includeChildDatabases?: boolean;
  out: string;
  stdout: boolean;
};

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const a: Args = { service: 'tirocinium', out: 'data/notion', stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    switch (t) {
      case '--service': a.service = argv[++i] ?? a.service; break;
      case '--token': a.token = argv[++i]; break;
      case '--max-depth': a.maxDepth = Number(argv[++i]); break;
      case '--max-pages': a.maxPages = Number(argv[++i]); break;
      case '--no-child-db': a.includeChildDatabases = false; break;
      case '--out': a.out = argv[++i] ?? a.out; break;
      case '--stdout': a.stdout = true; break;
      default:
        if (t.startsWith('--')) throw new Error(`unknown option: ${t}`);
        positional.push(t);
    }
  }
  if (positional[0]) a.databaseId = positional[0];
  return a;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // token を明示しない限り secret-agent から設定を取得 (env 不使用)。
  let secrets: Record<string, string> = {};
  if (!args.token) {
    try {
      secrets = await resolveSecrets(args.service, { keys: SECRET_KEYS });
      console.error(`[notion-crawl] secret-agent から ${Object.keys(secrets).length} 件取得 (service=${args.service})`);
    } catch (err) {
      const e = err as SecretAgentError;
      throw new Error(
        `secret-agent から設定取得に失敗 (${e.code ?? 'error'}): ${e.message}\n` +
          `Excubitor が起動し service '${args.service}' の Infisical マッピングに NOTION_TOKEN 等がある事を確認してください。` +
          ` (緊急時は --token <t> <DB_ID> で agent を回避できます)`,
      );
    }
  }

  const token = args.token ?? secrets['NOTION_TOKEN'];
  if (!token) throw new Error('NOTION_TOKEN が見つかりません (agent の service マッピング or --token)');

  const databaseId = args.databaseId ?? secrets['NOTION_DATABASE_ID'];
  if (!databaseId) {
    throw new Error('DATABASE_ID が必要です (位置引数 or agent の NOTION_DATABASE_ID)');
  }

  const client = new NotionApiClient({
    token,
    notionVersion: secrets['NOTION_VERSION'],
    minIntervalMs: num(secrets['NOTION_MIN_INTERVAL_MS']),
  });

  const maxDepth = args.maxDepth ?? num(secrets['NOTION_MAX_DEPTH']);
  const maxPages = args.maxPages ?? num(secrets['NOTION_MAX_PAGES']);
  const includeChildDatabases =
    args.includeChildDatabases ??
    (secrets['NOTION_INCLUDE_CHILD_DB'] ? secrets['NOTION_INCLUDE_CHILD_DB'] !== '0' : undefined);

  console.error(`[notion-crawl] crawling database ${databaseId} (maxDepth=${maxDepth ?? 3})`);
  const result = await crawlDatabase(client, databaseId, { maxDepth, maxPages, includeChildDatabases });
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
  const dir = resolve(REPO_ROOT, args.out, databaseId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${stamp}.json`);
  await writeFile(file, payload, 'utf8');
  console.error(`[notion-crawl] written: ${file}`);
}

main().catch((err) => {
  console.error('[notion-crawl] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
