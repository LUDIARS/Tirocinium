import dotenv from 'dotenv';

// .env.local (dev プロファイル) を優先し、無い値だけ .env で補完する。
// dotenv は既存 process.env を上書きしないため、先に読んだ .env.local が勝つ。
dotenv.config({ path: '.env.local' });
dotenv.config();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? Number.parseInt(v, 10) : fallback;
}

function bool(name: string): boolean {
  return process.env[name] === '1' || process.env[name]?.toLowerCase() === 'true';
}

export const config = {
  port: num('TIROCINIUM_PORT', 8084),
  host: process.env.TIROCINIUM_HOST ?? '0.0.0.0',
  databaseUrl: req('DATABASE_URL'),
  cernerePublicKey: process.env.CERNERE_PUBLIC_KEY ?? '',
  cernereAudience: process.env.CERNERE_AUDIENCE ?? 'tirocinium',
  // --- Windows Local / dev プロファイル ---
  // 鍵を持たない 1 台環境で面接を一周させるための開発専用バイパス。
  // 本番では必ず未設定 (0) にすること。spec/setup/windows-local-dev.md 参照。
  devAuth: bool('TIROCINIUM_DEV_AUTH'),
  devUserId: process.env.TIROCINIUM_DEV_USER_ID ?? '00000000-0000-0000-0000-000000000001',
  // 'api' = Anthropic SDK 直叩き (ANTHROPIC_API_KEY 必須) / 'cli' = claude CLI 経由 (鍵不要)
  llmBackend: (process.env.TIROCINIUM_LLM_BACKEND ?? 'api') as 'api' | 'cli',
  slotDurationMin: num('SLOT_DURATION_MIN', 30),
  slotCapacity: num('SLOT_CAPACITY', 4),
  noShowTimeoutMin: num('NO_SHOW_TIMEOUT_MIN', 5),
  notifyLeadMin: num('NOTIFY_LEAD_MIN', 15),
  nuntiusUrl: process.env.NUNTIUS_URL ?? '',
  nuntiusApiKey: process.env.NUNTIUS_API_KEY ?? '',
  discord: {
    botToken: process.env.TIROCINIUM_DISCORD_BOT_TOKEN ?? '',
    guildId: process.env.TIROCINIUM_DISCORD_GUILD_ID ?? '',
    categoryId: process.env.TIROCINIUM_DISCORD_CATEGORY_ID ?? '',
    allowedChannelIds: (process.env.TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    commandPrefix: process.env.TIROCINIUM_DISCORD_COMMAND_PREFIX ?? '!tr',
  },
  // 企業クロール (POST /api/v1/companies/crawl) 設定。
  // 外部 fetch を伴うため maxPages で 1 回あたりの取得数を絞り、 礼節 UA を名乗る。
  companyCrawl: {
    maxPages: num('COMPANY_CRAWL_MAX_PAGES', 20),
    fetchTimeoutMs: num('COMPANY_CRAWL_FETCH_TIMEOUT_MS', 15_000),
    userAgent:
      process.env.COMPANY_CRAWL_USER_AGENT ??
      'TirociniumBot/0.1 (+https://github.com/LUDIARS/Tirocinium)',
    // 設定時はこの user_id のみクロール可。 空なら全 authed user 可 (dev)。
    adminIds: (process.env.COMPANY_CRAWL_ADMIN_IDS ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  },
  // セッション作成 (POST /api/v1/sessions) の per-user レート制限。
  // 乱用 / 暴走クライアントによる予約枠・LLM コストの食い潰しを防ぐ。
  sessionRateLimit: {
    windowMs: num('SESSION_RATELIMIT_WINDOW_MS', 60_000),
    max: num('SESSION_RATELIMIT_MAX', 10),
  },
} as const;
