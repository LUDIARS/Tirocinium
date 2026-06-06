// 企業クロール + ES おすすめ企業の共通ドメイン型。
// 企業情報は「公開情報」 のため Tirocinium DB に保持してよい (DESIGN §6 の個人データ境界対象外)。
// 一方 ES 本文は保持しない — recommend は request scope の es_text / Memoria RAG 経由でのみ参照する。

/** 募集職種レンズ。 interviewer_personas.role_lens と揃える。 */
export const ROLE_LENSES = ['planner', 'programmer', 'designer', 'sound', 'any'] as const;
export type RoleLens = (typeof ROLE_LENSES)[number];

/** クロール/抽出で得た 1 社分の正規化前入力。 */
export type CompanyInput = {
  name: string;
  url?: string;
  industry?: string;
  description?: string;
  /** 募集職種 (RoleLens に正規化される前の生値も許容) */
  roles?: string[];
  /** 技術スタック / 社風キーワード等 */
  tags?: string[];
  location?: string;
  /** 社員規模など (例 '50-200名') */
  size?: string;
  /** 抽出元 source id (例 'manual' / 'seed-file') */
  source?: string;
  source_url?: string;
};

/** 正規化済の 1 社分レコード (DB 投入前の確定形)。 */
export type NormalizedCompany = {
  name: string;
  /** dedup キー (lower + 記号除去) */
  normalized_name: string;
  url: string;
  industry: string;
  description: string;
  roles: RoleLens[];
  tags: string[];
  location: string;
  size: string;
  source: string;
  source_url: string;
};

/** DB から読み出した 1 社分 (id 付き)。 */
export type Company = NormalizedCompany & {
  id: string;
  /** 発見シグナル (migration 004)。 listing 由来で立つ。 既存行は false。 */
  is_newgrad: boolean;
  is_game: boolean;
  has_opening: boolean;
  recruit_url: string;
  /** ストック理由 (新卒採用あり 等) */
  stock_reason: string;
  crawled_at: string;
  updated_at: string;
};

/** クロールの seed (取得対象 URL)。 */
export type CrawlSeed = {
  url: string;
  /** 既知の社名 (任意。 抽出のヒント) */
  nameHint?: string;
};

/** クロールソース。 discover() で取得対象 seed を列挙する。 */
export type CrawlSource = {
  id: string;
  /** seed URL を列挙する。 fetcher は HTTP GET を行う関数 (DI)。 */
  discover(ctx: CrawlContext): Promise<CrawlSeed[]>;
};

/** クロール実行時の依存注入 (HTTP / 設定)。 */
export type CrawlContext = {
  fetchText: (url: string) => Promise<string>;
  /** request / source で渡された明示 URL 群 */
  urls?: string[];
  /** seed-file ソース用のレコード列 */
  seedRecords?: CompanyInput[];
  maxPages: number;
};

// ── listing クロール (新卒/ゲーム企業の発見) ───────────────────────────

/** ストック判定に使う企業シグナル。 */
export type CompanyFlags = {
  /** 新卒採用をしている */
  isNewgrad: boolean;
  /** ゲーム企業 */
  isGame: boolean;
  /** 現在募集 (新卒/中途問わず求人) がある */
  hasOpening: boolean;
};

/** listing ページから抽出した 1 社分のエントリ (発見段階)。 */
export type ListingEntry = {
  name: string;
  /** 採用 / 求人ページ URL (任意) */
  recruitUrl?: string;
  /** 企業サイト URL (任意) */
  url?: string;
  /** 業界ヒント */
  industry?: string;
  /** listing 上の説明 / 職種スニペット (classify の材料) */
  snippet?: string;
  /** LLM が listing から推定したフラグ (任意。 keyword heuristic と統合する) */
  flagsHint?: Partial<CompanyFlags>;
};

/** listing ソース設定 (data/companies/listing-sources.json)。 */
export type ListingSourceConfig = {
  id: string;
  /** 種別。 表示 / 既定の有効可否の目安 */
  kind: 'job-aggregator' | 'game' | 'seed-list' | 'newgrad-nav';
  /** listing ページ URL 群 */
  urls: string[];
  /** false の source は明示 opt-in (env) が無い限り起動しない */
  enabled: boolean;
  /** メモ (ToS 注意など) */
  note?: string;
};

// ── enrichment (企業サイト → IR / 理念) ────────────────────────────────

/** 企業サイトから抽出すべきページ種別のリンク集。 */
export type EnrichmentLinks = {
  ir: string[];
  philosophy: string[];
  about: string[];
  recruit: string[];
};

/** 企業サイト巡回で得た profile (IR / 理念 等)。 */
export type CompanyProfileInput = {
  /** 企業理念 / ミッション */
  philosophy?: string;
  /** バリュー / 行動指針 */
  values?: string[];
  /** IR ハイライト要約 */
  ir_summary?: string;
  /** 事業概要 */
  business?: string;
  /** 巡回したページ URL */
  sources?: string[];
};

export type CompanyProfile = CompanyProfileInput & {
  company_id: string;
  fetched_at: string;
};

/** robots.txt の評価ルール (特定 UA 向けに畳んだもの)。 */
export type RobotsRules = {
  /** disallow パス接頭辞 */
  disallow: string[];
  /** allow パス接頭辞 (disallow より長い前方一致が勝つ) */
  allow: string[];
  /** Crawl-delay 秒 (任意) */
  crawlDelay?: number;
};

/** クロール結果サマリ。 */
export type CrawlSummary = {
  source: string;
  discovered: number;
  fetched: number;
  extracted: number;
  upserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
};

// ── recommend ─────────────────────────────────────────────────────────

/** ES など本人プロファイルの要約 (recommend 入力)。 */
export type ApplicantProfile = {
  /** ES / portfolio から抽出したプレーンテキスト (request scope、 永続化しない) */
  esText: string;
  targetRole?: RoleLens | string;
  targetCompany?: string;
  /** 希望タグ (志望業界 / 興味技術 等) */
  tags: string[];
  /** weakness_profiles.weak_top3 (鍛えるべき軸)。 任意。 */
  weakAxes?: string[];
};

/** おすすめ 1 件。 */
export type RecommendationItem = {
  company_id: string;
  name: string;
  /** 0-100 の適合スコア */
  score: number;
  /** おすすめ理由 (ES を逐語コピーせず要約。 §6) */
  reasons: string[];
  /** 懸念 / ミスマッチ点 */
  concerns: string[];
};

export type RecommendationResult = {
  method: 'llm' | 'heuristic';
  model: string;
  items: RecommendationItem[];
};
