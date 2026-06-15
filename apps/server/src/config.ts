// 企業DBは public read、面接/予約/評価/クロール操作は Cernere 認証付き。
// ローカル開発だけ TIROCINIUM_DEV_AUTH=1 で固定 dev user を使える。

export const config = {
  port: 8084,
  // 既定は loopback。外部公開する場合は TIROCINIUM_HOST と Cernere 設定を必ず入れる。
  host: '127.0.0.1',
  databaseUrl: '',  // 空 = SQLite (data/tirocinium.sqlite)。db/index.ts 参照。
  cernerePublicKey: '',
  cernereAudience: 'tirocinium',
  devAuth: false,
  devUserId: '00000000-0000-0000-0000-000000000001',
  llmBackend: 'api' as 'api' | 'cli',
  slotDurationMin: 30,
  slotCapacity: 4,
  noShowTimeoutMin: 5,
  notifyLeadMin: 15,
  // Nuntius 通知は nuntiusUrl 空なら nop (ローカルツールモード)。
  nuntiusUrl: '',
  nuntiusApiKey: '',
  discord: {
    botToken: '',
    guildId: '',
    categoryId: '',
    allowedChannelIds: [] as string[],
    commandPrefix: '!tr',
  },
  companyCrawl: {
    maxPages: 20,
    fetchTimeoutMs: 15_000,
    minIntervalMs: 2_000,
    respectRobots: true,
    enrichMaxPages: 5,
    userAgent: 'TirociniumBot/0.1 (+https://github.com/LUDIARS/Tirocinium)',
    adminIds: [] as string[],
    listingOptInSources: [] as string[],
    // 中小のみ stock する (spec/companies/listing-bundle.md §2③)。 既定 off。
    requireSMB: false,
    // 巨大一覧の分割抽出 (§2①)。 1 チャンク文字数 / 全文上限 / チャンク上限。
    listingChunkChars: 16_000,
    listingMaxChars: 120_000,
    listingMaxChunks: 12,
  },
  sessionRateLimit: {
    windowMs: 60_000,
    max: 10,
  },
};
// 注: `as const` は付けない。 hydrateSecrets() が起動時にフィールドを書き換えるため mutable にしている。
