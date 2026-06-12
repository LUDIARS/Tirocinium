// 起動時に Excubitor secret-agent から server の全 config を取得して注入する。
// env もファイルも使わず、 process memory (config オブジェクト / process.env 最小限) にのみ載せる。
// agent 不通 / 未設定なら例外を投げ、起動を止める。

import { config } from '../config.js';
import { resolveSecrets } from '@tirocinium/secrets';
import { applyDiscordSecrets, applyServerConfig } from './apply.js';

/** secret-agent の service code (既定 'tirocinium')。 */
const SERVICE_CODE = process.env['TIROCINIUM_SERVICE_CODE'] ?? 'tirocinium';

/** agent から取得する全 config キー。 */
export const SECRET_KEYS = [
  // サーバー基本設定
  'TIROCINIUM_PORT',
  'TIROCINIUM_HOST',
  'DATABASE_URL',
  'CERNERE_PUBLIC_KEY',
  'CERNERE_AUDIENCE',
  // dev バイパス
  'TIROCINIUM_DEV_AUTH',
  'TIROCINIUM_DEV_USER_ID',
  // LLM バックエンド
  'TIROCINIUM_LLM_BACKEND',
  // LLM API キー (process.env に passthrough)
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  // CLI バックエンド用 (Windows で claude CLI spawn に必要)
  'CLAUDE_CODE_GIT_BASH_PATH',
  // 通知
  'NUNTIUS_URL',
  'NUNTIUS_API_KEY',
  // RAG
  'MEMORIA_URL',
  // 予約スロット
  'SLOT_DURATION_MIN',
  'SLOT_CAPACITY',
  'NO_SHOW_TIMEOUT_MIN',
  'NOTIFY_LEAD_MIN',
  // 企業クロール
  'COMPANY_CRAWL_MAX_PAGES',
  'COMPANY_CRAWL_FETCH_TIMEOUT_MS',
  'COMPANY_CRAWL_MIN_INTERVAL_MS',
  'COMPANY_CRAWL_RESPECT_ROBOTS',
  'COMPANY_ENRICH_MAX_PAGES',
  'COMPANY_CRAWL_USER_AGENT',
  'COMPANY_CRAWL_ADMIN_IDS',
  'COMPANY_LISTING_OPTIN_SOURCES',
  // セッションレート制限
  'SESSION_RATELIMIT_WINDOW_MS',
  'SESSION_RATELIMIT_MAX',
  // Discord
  'TIROCINIUM_DISCORD_BOT_TOKEN',
  'TIROCINIUM_DISCORD_GUILD_ID',
  'TIROCINIUM_DISCORD_CATEGORY_ID',
  'TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS',
  'TIROCINIUM_DISCORD_COMMAND_PREFIX',
];

/** 起動時に secret-agent から全 config を取得して注入する。agent 不通なら例外。 */
export async function hydrateSecrets(): Promise<void> {
  const secrets = await resolveSecrets(SERVICE_CODE, { keys: SECRET_KEYS });
  const applied1 = applyServerConfig(config, secrets);
  const applied2 = applyDiscordSecrets(config.discord, secrets);
  const all = [...applied1, ...applied2];
  console.log(`[secrets] hydrated from agent: ${all.length} key(s) [${all.join(', ')}]`);
}
