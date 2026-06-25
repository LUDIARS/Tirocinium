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
    // 中小のみ stock する (spec/feature/companies/listing-bundle.md §2③)。 既定 off。
    requireSMB: false,
    // 巨大一覧の分割抽出 (§2①)。 1 チャンク文字数 / 全文上限 / チャンク上限。
    listingChunkChars: 16_000,
    listingMaxChars: 120_000,
    listingMaxChunks: 12,
  },
  // Google Maps (企業所在地マップ)。 key は secret 経由。 空ならマップ機能は無効。
  // JS API key はブラウザに渡る (HTTP referrer 制限前提)。 Geocoding にも同 key を使う。
  googleMaps: {
    apiKey: '',
  },
  // OB 合格リスト同期。 非公開 Google Sheet を service account で読み、 氏名を破棄して集計のみ DB へ。
  // creds / id は secret 経由 (リポ非コミット)。 serviceAccountJson か spreadsheetId 空なら同期は起動しない。
  obSheet: {
    serviceAccountJson: '',
    spreadsheetId: '',
    range: 'A:Z',
  },
  // gBizINFO (経産省 法人情報 API)。 token は secret 経由 (env 不使用)、 空なら gbiz-import は起動しない。
  gbiz: {
    token: '',
    minIntervalMs: 3_000,
    // 既定の粗フィルタ業種コード (情報通信業系)。 実 API で最適コードを確定する。
    defaultIndustry: '',
  },
  // 自動 enrich キュー: 概要なしのゲーム関連企業を 1 分 1 件で順次クロールする (LLM 必須)。
  enrichQueue: {
    enabled: true,
    intervalMs: 60_000, // 1 分に 1 件 (礼節)
  },
  // 企業クロールキュー: URL を投入すると 1 件ずつ順次クロールして企業を upsert する常駐 worker。
  // Web 取得は直列 (重複リクエストの無駄処理回避 + 負荷対策)。 enqueue 時に同一 URL の重複は畳む。
  crawlQueue: {
    enabled: true,
    intervalMs: 15_000, // この間隔で次の 1 件を取り出す (礼節)
    maxAttempts: 3, // 失敗時の最大試行回数
  },
  // 求人ニュース クロール (data/companies/news-sources.json)。 新着求人を検出 → Web 表示 + Nuntius 通知。
  // enabled=true で定期クロールを自動起動。 notifyUserId が空なら Nuntius 通知は no-op (Web 表示のみ)。
  jobNews: {
    enabled: false,
    dailyHour: 6, // 毎朝この時刻 (ローカル 0-23 時) に 1 回クロールする
    optInSources: [] as string[], // enabled=false の source を env で明示有効化 (例 gamebiz-jobs)
    notifyUserId: '', // Nuntius 通知先 user_id。 空なら通知しない (broadcast 相当の宛先)
    maxItemsPerSource: 60, // 1 ソース 1 回の取込み上限
  },
  sessionRateLimit: {
    windowMs: 60_000,
    max: 10,
  },
};
// 注: `as const` は付けない。 hydrateSecrets() が起動時にフィールドを書き換えるため mutable にしている。
