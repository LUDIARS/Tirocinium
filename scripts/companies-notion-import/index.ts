#!/usr/bin/env tsx
// Notion の企業リストを companies テーブルへ取込む (Canalis 経路)。
//   ① Canalis NotionSource → ② notionRecordToCompany → ③ upsertCompany
// 設定 (NOTION_TOKEN / NOTION_DATABASE_ID) は notion-crawl と同様 Excubitor secret-agent から。
//
// 使い方:
//   npm run companies:notion-import                   # 全て agent から
//   npm run companies:notion-import -- <DATABASE_ID>  # DB ID 明示 (token は agent)
//   npm run companies:notion-import -- --token secret_x <DATABASE_ID>

import { resolveSecrets, SecretAgentError } from '@tirocinium/secrets';
import { importCompaniesFromNotion } from '../../apps/server/src/companies/notion-canalis.js';

const SECRET_KEYS = ['NOTION_TOKEN', 'NOTION_DATABASE_ID', 'NOTION_VERSION'];

type Args = { databaseId?: string; service: string; token?: string };

function parseArgs(argv: string[]): Args {
  const a: Args = { service: 'tirocinium' };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === '--service') a.service = argv[++i] ?? a.service;
    else if (t === '--token') a.token = argv[++i];
    else if (t.startsWith('--')) throw new Error(`unknown option: ${t}`);
    else positional.push(t);
  }
  if (positional[0]) a.databaseId = positional[0];
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let secrets: Record<string, string> = {};
  if (!args.token || !args.databaseId) {
    try {
      secrets = await resolveSecrets(args.service, { keys: SECRET_KEYS });
    } catch (err) {
      const e = err as SecretAgentError;
      throw new Error(
        `secret-agent から設定取得に失敗 (${e.code ?? 'error'}): ${e.message}\n` +
          `service '${args.service}' の Infisical に NOTION_TOKEN / NOTION_DATABASE_ID がある事を確認してください。`,
      );
    }
  }

  const token = args.token ?? secrets['NOTION_TOKEN'];
  const databaseId = args.databaseId ?? secrets['NOTION_DATABASE_ID'];
  if (!databaseId) throw new Error('DATABASE_ID が必要です (位置引数 or agent の NOTION_DATABASE_ID)');

  if (token) process.env['NOTION_TOKEN'] = token;
  if (secrets['NOTION_VERSION']) process.env['NOTION_VERSION'] = secrets['NOTION_VERSION'];

  console.error(`[companies:notion-import] importing companies from notion database ${databaseId}`);
  const summary = await importCompaniesFromNotion({ databaseId, token });
  console.error(
    `[companies:notion-import] done: crawled=${summary.crawled} inserted=${summary.inserted} ` +
      `updated=${summary.updated} skipped=${summary.skipped}`,
  );
}

main().catch((err) => {
  console.error('[companies:notion-import] error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
