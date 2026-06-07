// resolved secret を Discord 設定へ反映する純粋関数。
// config.ts (DATABASE_URL を要求し import 時に throw しうる) に依存しないよう分離している。

/** config.discord と構造一致する反映先。 */
export type DiscordSecretTarget = {
  botToken: string;
  guildId: string;
  categoryId: string;
  allowedChannelIds: string[];
  commandPrefix: string;
};

/**
 * 解決済 secret を Discord 設定に反映する (空でない値のみ)。
 * @returns 適用したキー名
 */
export function applyDiscordSecrets(
  discord: DiscordSecretTarget,
  secrets: Record<string, string>,
): string[] {
  const applied: string[] = [];
  const set = (key: string, fn: (v: string) => void): void => {
    const v = secrets[key];
    if (v) {
      fn(v);
      applied.push(key);
    }
  };
  set('TIROCINIUM_DISCORD_BOT_TOKEN', (v) => (discord.botToken = v));
  set('TIROCINIUM_DISCORD_GUILD_ID', (v) => (discord.guildId = v));
  set('TIROCINIUM_DISCORD_CATEGORY_ID', (v) => (discord.categoryId = v));
  set('TIROCINIUM_DISCORD_COMMAND_PREFIX', (v) => (discord.commandPrefix = v));
  set('TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS', (v) => {
    discord.allowedChannelIds = v.split(',').map((s) => s.trim()).filter(Boolean);
  });
  return applied;
}
