// ローカルツールモード: SQLite + devAuth 固定、Cernere/Nuntius/Memoria 連携なし。
// LLM 設定のみ npm run config-setup で注入する。secrets/hydrate.ts 参照。

export const config = {
  port: 8084,
  // devAuth=true (全認証バイパス) で起動するため、既定は loopback のみに bind し
  // ネットワーク到達不能にする。外部公開が必要な場合のみ TIROCINIUM_HOST で上書きする。
  host: '127.0.0.1',
  databaseUrl: '',  // 空 = SQLite (data/tirocinium.sqlite)。db/index.ts 参照。
  // Cernere 認証は devAuth=true で常にバイパス (ローカルツールモード)。
  // 下記フィールドは cernere.ts の型要件のみ残す (実際には参照されない)。
  cernerePublicKey: '',
  cernereAudience: 'tirocinium',
  devAuth: true,
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
  },
  sessionRateLimit: {
    windowMs: 60_000,
    max: 10,
  },
};
// 注: `as const` は付けない。 hydrateSecrets() が起動時にフィールドを書き換えるため mutable にしている。
