// 起動時に Excubitor secret-agent から server の secret を取得して config に注入する。
// env もファイルも使わず、 process memory (config オブジェクト) にのみ載せる。
// agent 不通 / 未設定なら best-effort で skip し、 既存 (env 由来) config 値を使う。

import { config } from '../config.js';
import { resolveSecrets } from '@tirocinium/secrets';
import { applyDiscordSecrets } from './apply.js';

/** secret-agent の service code (既定 'tirocinium')。 */
const SERVICE_CODE = process.env['TIROCINIUM_SERVICE_CODE'] ?? 'tirocinium';

/** agent から拾う server secret キー (Discord bot token 等)。 */
export const SECRET_KEYS = [
  'TIROCINIUM_DISCORD_BOT_TOKEN',
  'TIROCINIUM_DISCORD_GUILD_ID',
  'TIROCINIUM_DISCORD_CATEGORY_ID',
  'TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS',
  'TIROCINIUM_DISCORD_COMMAND_PREFIX',
];

/** 起動時に secret-agent から取得して config に注入する (best-effort、 例外を投げない)。 */
export async function hydrateSecrets(): Promise<void> {
  try {
    const secrets = await resolveSecrets(SERVICE_CODE, { keys: SECRET_KEYS });
    const applied = applyDiscordSecrets(config.discord, secrets);
    console.log(`[secrets] hydrated from agent: ${applied.length} key(s) [${applied.join(', ')}]`);
  } catch (err) {
    console.warn(
      `[secrets] agent hydrate skipped (${(err as Error).message}) — 既存 config (env) を使用`,
    );
  }
}
