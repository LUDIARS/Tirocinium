// resolved secret を各 config セクションへ反映する純粋関数群。
// config.ts (DB 接続を持たない) にのみ依存するよう分離している。

import type { config as _cfg } from '../config.js';

type Config = typeof _cfg;

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
    if (v) { fn(v); applied.push(key); }
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

/** config.discordBackdoor と構造一致する反映先 (裏口 Bot B、 本体/面接の Bot A とは別管理)。 */
export type BackdoorSecretTarget = {
  botToken: string;
  guildId: string;
  allowedChannelIds: string[];
  commandPrefix: string;
  appBaseUrl: string;
  linkTtlMin: number;
  sessionTtlMin: number;
};

/**
 * 解決済 secret を裏口 Bot B 設定に反映する (空でない値のみ)。 Bot A とは別 token。
 * @returns 適用したキー名
 */
export function applyBackdoorSecrets(
  bd: BackdoorSecretTarget,
  secrets: Record<string, string>,
): string[] {
  const applied: string[] = [];
  const set = (key: string, fn: (v: string) => void): void => {
    const v = secrets[key];
    if (v) { fn(v); applied.push(key); }
  };
  const setNum = (key: string, fn: (n: number) => void): void => {
    const v = secrets[key];
    if (v !== undefined) {
      const n = Number.parseInt(v, 10);
      if (!Number.isNaN(n)) { fn(n); applied.push(key); }
    }
  };
  set('TIROCINIUM_BACKDOOR_BOT_TOKEN', (v) => (bd.botToken = v));
  set('TIROCINIUM_BACKDOOR_GUILD_ID', (v) => (bd.guildId = v));
  set('TIROCINIUM_BACKDOOR_COMMAND_PREFIX', (v) => (bd.commandPrefix = v));
  set('TIROCINIUM_BACKDOOR_APP_BASE_URL', (v) => (bd.appBaseUrl = v));
  set('TIROCINIUM_BACKDOOR_TEXT_CHANNEL_IDS', (v) => {
    bd.allowedChannelIds = v.split(',').map((s) => s.trim()).filter(Boolean);
  });
  setNum('TIROCINIUM_BACKDOOR_LINK_TTL_MIN', (n) => (bd.linkTtlMin = n));
  setNum('TIROCINIUM_BACKDOOR_SESSION_TTL_MIN', (n) => (bd.sessionTtlMin = n));
  return applied;
}

/**
 * 解決済 secret をサーバー config (Discord 以外) に反映する。
 * process.env への書き込みは子プロセス (claude CLI / SDK) への継承が必要なキーのみ行う。
 * @returns 適用したキー名
 */
export function applyServerConfig(
  cfg: Config,
  secrets: Record<string, string>,
): string[] {
  const applied: string[] = [];

  const set = (key: string, fn: (v: string) => void): void => {
    const v = secrets[key];
    if (v) { fn(v); applied.push(key); }
  };
  const setNum = (key: string, fn: (n: number) => void): void => {
    const v = secrets[key];
    if (v !== undefined) {
      const n = Number.parseInt(v, 10);
      if (!Number.isNaN(n)) { fn(n); applied.push(key); }
    }
  };
  const setBool = (key: string, fn: (b: boolean) => void): void => {
    const v = secrets[key];
    if (v !== undefined) {
      fn(v === '1' || v.toLowerCase() === 'true');
      applied.push(key);
    }
  };

  set('TIROCINIUM_HOST', (v) => { cfg.host = v; });
  setNum('TIROCINIUM_PORT', (v) => { cfg.port = v; });
  setBool('TIROCINIUM_DEV_AUTH', (v) => { cfg.devAuth = v; });
  set('CERNERE_PUBLIC_KEY', (v) => { cfg.cernerePublicKey = v; });
  set('CERNERE_AUDIENCE', (v) => { cfg.cernereAudience = v; });
  set('TIROCINIUM_LLM_BACKEND', (v) => { cfg.llmBackend = v as 'api' | 'cli'; });
  setNum('SLOT_DURATION_MIN', (v) => { cfg.slotDurationMin = v; });
  setNum('SLOT_CAPACITY', (v) => { cfg.slotCapacity = v; });
  setNum('NO_SHOW_TIMEOUT_MIN', (v) => { cfg.noShowTimeoutMin = v; });
  setNum('NOTIFY_LEAD_MIN', (v) => { cfg.notifyLeadMin = v; });
  setNum('COMPANY_CRAWL_MAX_PAGES', (v) => { cfg.companyCrawl.maxPages = v; });
  setNum('COMPANY_CRAWL_FETCH_TIMEOUT_MS', (v) => { cfg.companyCrawl.fetchTimeoutMs = v; });
  setNum('COMPANY_CRAWL_MIN_INTERVAL_MS', (v) => { cfg.companyCrawl.minIntervalMs = v; });
  setBool('COMPANY_CRAWL_RESPECT_ROBOTS', (v) => { cfg.companyCrawl.respectRobots = v; });
  setNum('COMPANY_ENRICH_MAX_PAGES', (v) => { cfg.companyCrawl.enrichMaxPages = v; });
  set('COMPANY_CRAWL_USER_AGENT', (v) => { cfg.companyCrawl.userAgent = v; });
  set('COMPANY_CRAWL_ADMIN_IDS', (v) => {
    cfg.companyCrawl.adminIds = v.split(',').map((s) => s.trim()).filter(Boolean);
  });
  set('COMPANY_LISTING_OPTIN_SOURCES', (v) => {
    cfg.companyCrawl.listingOptInSources = v.split(',').map((s) => s.trim()).filter(Boolean);
  });
  setBool('COMPANY_REQUIRE_SMB', (v) => { cfg.companyCrawl.requireSMB = v; });
  setNum('COMPANY_LISTING_CHUNK_CHARS', (v) => { cfg.companyCrawl.listingChunkChars = v; });
  // Nuntius 通知 (予約リマインド + 求人ニュース通知)
  set('NUNTIUS_URL', (v) => { cfg.nuntiusUrl = v; });
  set('NUNTIUS_API_KEY', (v) => { cfg.nuntiusApiKey = v; });
  // 求人ニュース クロール
  setBool('COMPANY_JOB_NEWS_ENABLED', (v) => { cfg.jobNews.enabled = v; });
  setNum('COMPANY_JOB_NEWS_INTERVAL_MS', (v) => { cfg.jobNews.intervalMs = v; });
  set('COMPANY_JOB_NEWS_OPTIN_SOURCES', (v) => {
    cfg.jobNews.optInSources = v.split(',').map((s) => s.trim()).filter(Boolean);
  });
  set('COMPANY_JOB_NEWS_NOTIFY_USER_ID', (v) => { cfg.jobNews.notifyUserId = v; });
  set('GOOGLE_MAPS_API_KEY', (v) => { cfg.googleMaps.apiKey = v; });
  set('TIROCINIUM_OB_SHEET_SA_JSON', (v) => { cfg.obSheet.serviceAccountJson = v; });
  set('TIROCINIUM_OB_SHEET_ID', (v) => { cfg.obSheet.spreadsheetId = v; });
  set('TIROCINIUM_OB_SHEET_RANGE', (v) => { cfg.obSheet.range = v; });
  set('GBIZINFO_TOKEN', (v) => { cfg.gbiz.token = v; });
  setNum('GBIZINFO_MIN_INTERVAL_MS', (v) => { cfg.gbiz.minIntervalMs = v; });
  set('GBIZINFO_DEFAULT_INDUSTRY', (v) => { cfg.gbiz.defaultIndustry = v; });
  setNum('SESSION_RATELIMIT_WINDOW_MS', (v) => { cfg.sessionRateLimit.windowMs = v; });
  setNum('SESSION_RATELIMIT_MAX', (v) => { cfg.sessionRateLimit.max = v; });

  // 子プロセス (claude CLI / Anthropic SDK / OpenAI SDK) が直接 process.env を読むキーは
  // config への書込みに加え process.env にも注入する。
  const envPassthrough: Record<string, string> = {};
  for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_GIT_BASH_PATH']) {
    const v = secrets[key];
    if (v) { envPassthrough[key] = v; applied.push(key); }
  }
  Object.assign(process.env, envPassthrough);

  return applied;
}
