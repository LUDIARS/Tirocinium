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
