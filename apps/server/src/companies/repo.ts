import { sql, isSqlite } from '../db/index.js';
import {
  coerceSources,
  mergeSources,
  isSMBByEmployees,
  type Company,
  type NormalizedCompany,
} from '@tirocinium/companies';

// 遅延評価: sql は initSql() 後にしか呼べない (module-load 時点では未初期化)。
const selectCols = () => sql`
  id, name, normalized_name, url, industry, description,
  roles, tags, location, size, employee_count, listing_market, source, source_url,
  is_newgrad, is_game, has_opening, recruit_url, stock_reason,
  sources, is_smb, is_listed, corporate_number,
  crawled_at, updated_at
`;

export type CompanyFilter = {
  role?: string;
  tag?: string;
  industry?: string;
  q?: string;
  /** ノイズ除外: ゲームに紐付く or 求人(job_postings)を持つ企業のみ (概要の有無は問わない — 未取得は enrich 対象)。 */
  quality?: boolean;
  /** 情報あり (会社概要 description が非空) の企業のみ。 未取得は除外 (チェックで解除)。 */
  summarized?: boolean;
  /** 新卒採用ありの企業のみ (is_newgrad)。 既定の優先ソートとは独立した絞り込み。 */
  newgrad?: boolean;
  /** 現在募集中の企業のみ (has_opening)。 判定はキーワード heuristic ベースで粗め。 */
  opening?: boolean;
  limit?: number;
  offset?: number;
};

export type CompanyWithStats = Company & {
  article_count: number;
  has_newgrad_image: boolean;
  has_profile: boolean;
  /** 関与ゲーム数 (company_game edge 数)。 0 = どのゲームにも未紐付け。 */
  game_count: number;
};

/** フィルタ付き企業一覧。 role/tag は配列包含、 q は name/description/industry/role/tag の部分一致。
 *  article_count (記事数) / has_newgrad_image (新卒像) / has_profile (IR・理念クロール済) を付加。 */
export async function listCompanies(filter: CompanyFilter = {}): Promise<CompanyWithStats[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = await sql<CompanyWithStats[]>`
    SELECT
      c.id, c.name, c.normalized_name, c.url, c.industry, c.description,
      c.roles, c.tags, c.location, c.size, c.employee_count, c.listing_market, c.source, c.source_url,
      c.is_newgrad, c.is_game, c.has_opening, c.recruit_url, c.stock_reason,
      c.sources, c.is_smb, c.is_listed, c.corporate_number,
      c.crawled_at, c.updated_at,
      (SELECT count(*) FROM company_interview_articles a WHERE a.company_id = c.id) AS article_count,
      CASE WHEN EXISTS(SELECT 1 FROM company_newgrad_role_images r WHERE r.company_id = c.id)
           THEN TRUE ELSE FALSE END AS has_newgrad_image,
      CASE WHEN EXISTS(SELECT 1 FROM company_profiles p WHERE p.company_id = c.id)
           THEN TRUE ELSE FALSE END AS has_profile,
      (SELECT count(*) FROM company_game cg WHERE cg.company_id = c.id) AS game_count
    FROM companies c
    ${companyFilterSql(filter)}
    -- 新卒採用あり ∧ 募集中 を最上位に出す (ユーザ要望)。 続けて新卒のみ → 募集中のみ → 更新日時。
    -- bool は PG=true/SQLite=1 で DESC が「該当を先頭」に統一できる。
    ORDER BY
      (c.is_newgrad AND c.has_opening) DESC,
      c.is_newgrad DESC,
      c.has_opening DESC,
      c.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map((r) => ({
    ...r,
    article_count: Number(r.article_count),
    game_count: Number(r.game_count),
  }));
}

function companyFilterSql(filter: CompanyFilter) {
  const like = filter.q ? '%' + filter.q + '%' : '';
  return sql`
    WHERE TRUE
      ${filter.role ? (isSqlite ? sql`AND EXISTS (SELECT 1 FROM json_each(c.roles) WHERE value = ${filter.role})` : sql`AND ${filter.role} = ANY(c.roles)`) : sql``}
      ${filter.tag ? (isSqlite ? sql`AND EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value = ${filter.tag})` : sql`AND ${filter.tag} = ANY(c.tags)`) : sql``}
      ${filter.industry ? sql`AND c.industry = ${filter.industry}` : sql``}
      ${filter.quality ? sql`
        AND (
          EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
          OR EXISTS (SELECT 1 FROM job_postings jp WHERE jp.company_id = c.id)
        )
      ` : sql``}
      ${filter.summarized ? sql`AND c.description <> ''` : sql``}
      ${filter.newgrad ? sql`AND c.is_newgrad` : sql``}
      ${filter.opening ? sql`AND c.has_opening` : sql``}
      ${filter.q ? (isSqlite
        ? sql`AND (
            c.name LIKE ${like}
            OR c.description LIKE ${like}
            OR c.industry LIKE ${like}
            OR EXISTS (SELECT 1 FROM json_each(c.roles) WHERE value LIKE ${like})
            OR EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value LIKE ${like})
          )`
        : sql`AND (
            c.name ILIKE ${like}
            OR c.description ILIKE ${like}
            OR c.industry ILIKE ${like}
            OR EXISTS (SELECT 1 FROM unnest(c.roles) AS role WHERE role ILIKE ${like})
            OR EXISTS (SELECT 1 FROM unnest(c.tags) AS tag WHERE tag ILIKE ${like})
          )`) : sql``}
  `;
}

export async function getCompany(id: string): Promise<Company | null> {
  const rows = await sql<Company[]>`SELECT ${selectCols()} FROM companies WHERE id = ${id}`;
  return rows[0] ?? null;
}

/** dedup キー (normalized_name) で 1 社引く。 upsert 直後に id を得る用途。 */
export async function getCompanyByNormalizedName(normalizedName: string): Promise<Company | null> {
  const rows = await sql<Company[]>`
    SELECT ${selectCols()} FROM companies WHERE normalized_name = ${normalizedName}
  `;
  return rows[0] ?? null;
}

/** 法人番号で 1 社引く (名寄せ用)。 '' は対象外。 複数該当時は最初の 1 件。 */
export async function getCompanyByCorporateNumber(corporateNumber: string): Promise<Company | null> {
  const n = (corporateNumber ?? '').trim();
  if (!n) return null;
  const rows = await sql<Company[]>`
    SELECT ${selectCols()} FROM companies WHERE corporate_number = ${n} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** recommend 用に全件 (上限あり) を取得する。 candidate scoring 対象。 */
export async function allCompaniesForScoring(limit = 1000): Promise<Company[]> {
  return sql<Company[]>`
    SELECT ${selectCols()} FROM companies
    ORDER BY updated_at DESC
    LIMIT ${Math.min(limit, 5000)}
  `;
}

export async function countCompanies(filter: CompanyFilter = {}): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM companies c
    ${companyFilterSql(filter)}
  `;
  return Number(rows[0]?.count ?? 0);
}

/** listing 由来の発見シグナル (任意)。 既存の true は OR で温存 (sticky)。 */
export type DiscoverySignals = {
  isNewgrad?: boolean;
  isGame?: boolean;
  hasOpening?: boolean;
  /** 中小フラグ (spec/feature/companies/listing-bundle.md §2③)。 */
  isSMB?: boolean;
  /** 上場シグナル (中小判定の材料)。 */
  isListed?: boolean;
  recruitUrl?: string;
  stockReason?: string;
  /** 法人番号 (gBizINFO 由来、 migration 012)。 名寄せ用の安定キー。 */
  corporateNumber?: string;
};

/**
 * normalized_name で upsert する。 既存なら空でない値だけ更新 (クロール毎の劣化を防ぐ)。
 * フラグは OR でマージし、 一度立った新卒/ゲーム/募集は温存する。
 * 出所 (sources) は既存 + 今回分を read-merge-write で累積する (§2②)。
 * 会社規模は従業員数 (employee_count) 駆動で is_smb を決める (不明(0) or {@link SMB_EMPLOYEE_MAX} 以下→中小)。
 * 上場区分は listing_market タグ (prime/growth/standard/other)、 is_listed はその有無。
 * @returns 'inserted' | 'updated'
 */
export async function upsertCompany(
  c: NormalizedCompany,
  signals: DiscoverySignals = {},
): Promise<'inserted' | 'updated'> {
  const isNewgrad = signals.isNewgrad ?? false;
  const isGame = signals.isGame ?? false;
  const hasOpening = signals.hasOpening ?? false;
  // is_smb は会社規模 (従業員数) で決まる。 不明(0) or 上限以下 → 中小 (ユーザ定義)。
  // 上場や heuristic とは独立 (上場有無は listing_market / is_listed で別管理)。
  const isSMB = isSMBByEmployees(c.employee_count);
  const isListed = signals.isListed ?? c.listing_market !== '';
  const recruitUrl = signals.recruitUrl ?? '';
  const stockReason = signals.stockReason ?? '';
  const corporateNumber = signals.corporateNumber ?? '';

  // 出所累積: 既存 sources を読み、 今回の {source, url} をマージする (PG/SQLite 共通の read-merge-write)。
  const existing = await sql<{ sources: unknown }[]>`
    SELECT sources FROM companies WHERE normalized_name = ${c.normalized_name}
  `;
  const wasPresent = existing.length > 0;
  const merged = mergeSources(
    wasPresent ? coerceSources(existing[0]?.sources) : [],
    [{ source: c.source, url: c.source_url || c.url }],
  );

  await sql`
    INSERT INTO companies
      (name, normalized_name, url, industry, description, roles, tags, location, size,
       employee_count, listing_market, source, source_url,
       is_newgrad, is_game, has_opening, recruit_url, stock_reason, sources, is_smb, is_listed,
       corporate_number)
    VALUES (
      ${c.name}, ${c.normalized_name}, ${c.url}, ${c.industry}, ${c.description},
      ${c.roles}, ${c.tags}, ${c.location}, ${c.size},
      ${c.employee_count}, ${c.listing_market}, ${c.source}, ${c.source_url},
      ${isNewgrad}, ${isGame}, ${hasOpening}, ${recruitUrl}, ${stockReason},
      ${sql.json(merged)}, ${isSMB}, ${isListed},
      ${corporateNumber}
    )
    ON CONFLICT (normalized_name) DO UPDATE SET
      name        = EXCLUDED.name,
      url         = COALESCE(NULLIF(EXCLUDED.url, ''), companies.url),
      industry    = COALESCE(NULLIF(EXCLUDED.industry, ''), companies.industry),
      description = COALESCE(NULLIF(EXCLUDED.description, ''), companies.description),
      roles       = CASE WHEN cardinality(EXCLUDED.roles) > 0 THEN EXCLUDED.roles ELSE companies.roles END,
      tags        = CASE WHEN cardinality(EXCLUDED.tags) > 0 THEN EXCLUDED.tags ELSE companies.tags END,
      location    = COALESCE(NULLIF(EXCLUDED.location, ''), companies.location),
      size        = COALESCE(NULLIF(EXCLUDED.size, ''), companies.size),
      employee_count = CASE WHEN EXCLUDED.employee_count > 0 THEN EXCLUDED.employee_count ELSE companies.employee_count END,
      listing_market = COALESCE(NULLIF(EXCLUDED.listing_market, ''), companies.listing_market),
      source      = EXCLUDED.source,
      source_url  = COALESCE(NULLIF(EXCLUDED.source_url, ''), companies.source_url),
      is_newgrad  = companies.is_newgrad OR EXCLUDED.is_newgrad,
      is_game     = companies.is_game OR EXCLUDED.is_game,
      has_opening = companies.has_opening OR EXCLUDED.has_opening,
      recruit_url = COALESCE(NULLIF(EXCLUDED.recruit_url, ''), companies.recruit_url),
      stock_reason= COALESCE(NULLIF(EXCLUDED.stock_reason, ''), companies.stock_reason),
      sources     = EXCLUDED.sources,
      corporate_number = COALESCE(NULLIF(EXCLUDED.corporate_number, ''), companies.corporate_number),
      is_listed   = companies.is_listed OR EXCLUDED.is_listed,
      -- is_smb は「最終的な従業員数」から純粋導出 (不明=0 も中小)。 SMB_EMPLOYEE_MAX=300。
      is_smb      = CASE WHEN (CASE WHEN EXCLUDED.employee_count > 0 THEN EXCLUDED.employee_count ELSE companies.employee_count END) <= 300 THEN TRUE ELSE FALSE END,
      updated_at  = now()
  `;
  return wasPresent ? 'updated' : 'inserted';
}

/**
 * 特定企業 (id 指定) の空フィールドを埋める (情報提供ウインドウ由来の追記)。
 * 既存の非空値は壊さない (COALESCE + NULLIF)。 url を補うと以後の自動 enrich が回る。
 * @returns 更新された (= 1 行ヒットした) か
 */
export async function updateCompanyInfo(
  id: string,
  fields: { description?: string; industry?: string; url?: string; location?: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE companies SET
      description = COALESCE(NULLIF(${fields.description ?? ''}, ''), description),
      industry   = COALESCE(NULLIF(${fields.industry ?? ''}, ''), industry),
      url        = COALESCE(NULLIF(${fields.url ?? ''}, ''), url),
      location   = COALESCE(NULLIF(${fields.location ?? ''}, ''), location),
      updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}

// ── 自動 enrich キュー (migration 014、 概要なし企業を 1 分 1 件で順次クロール) ──

/** 自動 enrich の次の 1 社を選ぶ。 概要なし ∧ url 有 ∧ ゲーム関連、 最も試行が古い順。 */
export async function nextCompanyForAutoEnrich(): Promise<Company | null> {
  const rows = await sql<Company[]>`
    SELECT ${selectCols()} FROM companies c
    WHERE c.description = ''
      AND c.url <> ''
      AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    ORDER BY (c.enrich_attempted_at IS NULL) DESC, c.enrich_attempted_at ASC, c.updated_at ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** 自動 enrich を試行した記録を残す (再ピックの間隔を空ける)。 */
export async function markEnrichAttempted(id: string): Promise<void> {
  await sql`UPDATE companies SET enrich_attempted_at = now() WHERE id = ${id}`;
}

/** 自動 enrich キューの規模 (残り = 概要なし ∧ url有 ∧ ゲーム関連)。 */
export async function autoEnrichStats(): Promise<{ pending: number; attempted: number }> {
  const rows = await sql<{ pending: string; attempted: string }[]>`
    SELECT
      sum(CASE WHEN c.description = '' THEN 1 ELSE 0 END)::text AS pending,
      sum(CASE WHEN c.description = '' AND c.enrich_attempted_at IS NOT NULL THEN 1 ELSE 0 END)::text AS attempted
    FROM companies c
    WHERE c.url <> '' AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
  `;
  return { pending: Number(rows[0]?.pending ?? 0), attempted: Number(rows[0]?.attempted ?? 0) };
}

/** enrichment 対象 (url を持ち profile 未取得) の企業を返す。 */
export async function companiesNeedingEnrichment(limit = 50): Promise<Company[]> {
  return sql<Company[]>`
    SELECT ${selectCols()} FROM companies c
    WHERE c.url <> ''
      AND NOT EXISTS (SELECT 1 FROM company_profiles p WHERE p.company_id = c.id)
    ORDER BY c.updated_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `;
}

// ── Wikidata 公式HP (P856) 補完 (spec/feature/companies/game-graph.md §0 / 名寄れ補完) ──

/**
 * Wikidata 発見社で url 未取得の企業を返す (社名→公式HP 特定の対象)。
 * source='wikidata' ∧ url='' を更新が古い順に。 url が埋まると以後の自動 enrich 対象になる。
 */
export async function companiesNeedingUrlFromWikidata(limit = 50): Promise<Company[]> {
  return sql<Company[]>`
    SELECT ${selectCols()} FROM companies c
    WHERE c.url = ''
      AND c.source = 'wikidata'
    ORDER BY c.updated_at ASC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `;
}

// ── IR 従業員数 裏取り (spec/feature/companies/game-graph.md §5.4 Phase4) ──

/**
 * IR 従業員裏取りの対象社。 employee_count=0 (規模不明) ∧ url 有 を対象に、
 * 上場社 (listing_market<>'' or is_listed) を優先する (IR ページを持つ確度が高い)。
 * research 名寄れ失敗の非上場社も後続で拾う。
 */
export async function companiesNeedingIrEmployee(limit = 20): Promise<Company[]> {
  return sql<Company[]>`
    SELECT ${selectCols()} FROM companies c
    WHERE c.employee_count = 0
      AND c.url <> ''
    ORDER BY (c.listing_market <> '' OR c.is_listed) DESC, c.updated_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `;
}

/**
 * 従業員数を確定値で更新し、 is_smb を再導出する (IR 裏取り由来)。
 * count<=0 は no-op (不明で上書きしない)。 確定情報なので既存値があっても上書きする。
 * @returns 更新された (1 行ヒット) か
 */
export async function updateEmployeeCount(id: string, count: number): Promise<boolean> {
  if (!Number.isFinite(count) || count <= 0) return false;
  const rows = await sql<{ id: string }[]>`
    UPDATE companies SET
      employee_count = ${Math.round(count)},
      is_smb = ${isSMBByEmployees(count)},
      updated_at = now()
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}
