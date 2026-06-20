// 起動時にローカル暗号化 config (または secret-agent) から設定を注入する。
// ローカル config が未設定でもデフォルト値で起動する (LLM 呼出時にエラーになる)。

import { config } from '../config.js';
import { resolveSecrets, readLocalSecrets, SecretAgentError, localConfigPath, type ResolvedSecrets } from '@tirocinium/secrets';
import { applyDiscordSecrets, applyServerConfig } from './apply.js';

/** secret-agent の service code (既定 'tirocinium')。 */
const SERVICE_CODE = process.env['TIROCINIUM_SERVICE_CODE'] ?? 'tirocinium';

/** agent / ローカル config から取得するキー (ローカルツールモード用に絞り込み済み)。 */
export const SECRET_KEYS = [
  // サーバー基本設定 (省略時はデフォルト値)
  'TIROCINIUM_PORT',
  'TIROCINIUM_HOST',
  'TIROCINIUM_DEV_AUTH',
  'CERNERE_PUBLIC_KEY',
  'CERNERE_AUDIENCE',
  // LLM バックエンド
  'TIROCINIUM_LLM_BACKEND',
  // LLM API キー (process.env に passthrough)
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  // CLI バックエンド用 (Windows で claude CLI spawn に必要)
  'CLAUDE_CODE_GIT_BASH_PATH',
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
  'COMPANY_REQUIRE_SMB',
  'COMPANY_LISTING_CHUNK_CHARS',
  // Nuntius 通知
  'NUNTIUS_URL',
  'NUNTIUS_API_KEY',
  // 求人ニュース クロール
  'COMPANY_JOB_NEWS_ENABLED',
  'COMPANY_JOB_NEWS_DAILY_HOUR',
  'COMPANY_JOB_NEWS_OPTIN_SOURCES',
  'COMPANY_JOB_NEWS_NOTIFY_USER_ID',
  // Google Maps (企業所在地マップ)
  'GOOGLE_MAPS_API_KEY',
  // OB 合格リスト同期 (非公開 Google Sheet。 creds/id は secret 経由・リポ非コミット)
  'TIROCINIUM_OB_SHEET_SA_JSON',
  'TIROCINIUM_OB_SHEET_ID',
  'TIROCINIUM_OB_SHEET_RANGE',
  // gBizINFO (法人情報 API)
  'GBIZINFO_TOKEN',
  'GBIZINFO_MIN_INTERVAL_MS',
  'GBIZINFO_DEFAULT_INDUSTRY',
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

function envSecrets(): ResolvedSecrets {
  const out: ResolvedSecrets = {};
  for (const key of SECRET_KEYS) {
    const v = process.env[key];
    if (v) out[key] = v;
  }
  return out;
}

/** 起動時に config を注入する。優先順位: secret-agent → ローカル暗号化 config → デフォルト値で起動 */
export async function hydrateSecrets(): Promise<void> {
  let secrets: ResolvedSecrets;
  let source: string;

  try {
    secrets = await resolveSecrets(SERVICE_CODE, { keys: SECRET_KEYS });
    source = 'agent';
  } catch (err) {
    if (err instanceof SecretAgentError && (err.code === 'unreachable' || err.code === 'no_token')) {
      const local = readLocalSecrets();
      if (!local) {
        secrets = envSecrets();
        source = Object.keys(secrets).length > 0 ? 'env' : 'default';
        if (source === 'default') {
          console.warn('[secrets] ローカル config が見つかりません。デフォルト設定で起動します。');
          console.warn(`  LLM キーを設定するには: npm run config-setup  (保存先: ${localConfigPath()})`);
        }
      } else {
        secrets = { ...local, ...envSecrets() };
        source = 'local/env';
      }
    } else {
      throw err;
    }
  }

  secrets = { ...secrets, ...envSecrets() };
  const applied1 = applyServerConfig(config, secrets);
  const applied2 = applyDiscordSecrets(config.discord, secrets);
  const all = [...applied1, ...applied2];
  console.log(`[secrets] hydrated from ${source}: ${all.length} key(s) [${all.join(', ')}]`);
}
