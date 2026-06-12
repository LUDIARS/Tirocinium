// 起動時に secret-agent (Excubitor) から hydrateSecrets() で全値を注入する。
// env / dotenv は使用しない。secrets/hydrate.ts 参照。

export const config = {
  port: 8084,
  host: '0.0.0.0',
  databaseUrl: '',
  cernerePublicKey: '',
  cernereAudience: 'tirocinium',
  devAuth: false,
  devUserId: '00000000-0000-0000-0000-000000000001',
  llmBackend: 'api' as 'api' | 'cli',
  slotDurationMin: 30,
  slotCapacity: 4,
  noShowTimeoutMin: 5,
  notifyLeadMin: 15,
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
