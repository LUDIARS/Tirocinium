// Tirocinium ローカル暗号化 config セットアップ CLI
// 各 secret キーの値を対話入力し、マシン固有鍵で暗号化して保存する。
// 使用: npm run config-setup

import { createInterface } from 'node:readline/promises';
import { readLocalSecrets, setLocalConfig, localConfigPath, LOCAL_SECRET_KEYS } from '@tirocinium/secrets';

// apps/server/src/secrets/hydrate.ts の SECRET_KEYS と同期する。
const SECRET_KEYS: readonly string[] = [
  'TIROCINIUM_PORT',
  'TIROCINIUM_HOST',
  'TIROCINIUM_DEV_AUTH',
  'CERNERE_PUBLIC_KEY',
  'CERNERE_AUDIENCE',
  'TIROCINIUM_LLM_BACKEND',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'SLOT_DURATION_MIN',
  'SLOT_CAPACITY',
  'NO_SHOW_TIMEOUT_MIN',
  'NOTIFY_LEAD_MIN',
  'COMPANY_CRAWL_MAX_PAGES',
  'COMPANY_CRAWL_FETCH_TIMEOUT_MS',
  'COMPANY_CRAWL_MIN_INTERVAL_MS',
  'COMPANY_CRAWL_RESPECT_ROBOTS',
  'COMPANY_ENRICH_MAX_PAGES',
  'COMPANY_CRAWL_USER_AGENT',
  'COMPANY_CRAWL_ADMIN_IDS',
  'COMPANY_LISTING_OPTIN_SOURCES',
  'COMPANY_REQUIRE_SMB',
  'SESSION_RATELIMIT_WINDOW_MS',
  'SESSION_RATELIMIT_MAX',
  'TIROCINIUM_DISCORD_BOT_TOKEN',
  'TIROCINIUM_DISCORD_GUILD_ID',
  'TIROCINIUM_DISCORD_CATEGORY_ID',
  'TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS',
  'TIROCINIUM_DISCORD_COMMAND_PREFIX',
];

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== Tirocinium ローカル設定セットアップ ===');
  console.log(`保存先: ${localConfigPath()}`);
  console.log(`シークレットキー (暗号化保存): ${[...LOCAL_SECRET_KEYS].join(', ')}\n`);

  const existing = readLocalSecrets() ?? {};
  let savedCount = 0;

  for (const key of SECRET_KEYS) {
    const cur = existing[key];
    const hint = cur ? ` [現在値あり、Enterで維持]` : ` [Enterでスキップ]`;
    const answer = await rl.question(`${key}${hint}: `);
    const v = answer.trim();
    if (v) {
      setLocalConfig(key, v);
      savedCount++;
    }
  }

  rl.close();

  console.log(`\n設定を保存しました: ${localConfigPath()}`);
  console.log(`更新キー数: ${savedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
