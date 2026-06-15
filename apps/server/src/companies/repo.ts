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
  sources, is_smb, is_listed,
  crawled_at, updated_at
`;

export type CompanyFilter = {
  role?: string;
  tag?: string;
  industry?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type CompanyWithStats = Company & {
  article_count: number;
  has_newgrad_image: boolean;
  has_profile: boolean;
};

/** フィルタ付き企業一覧。 role/tag は配列包含、 q は name/description/industry/role/tag の部分一致。
 *  article_count (記事数) / has_newgrad_image (新卒像) / has_profile (IR・理念クロール済) を付加。 */
export async function listCompanies(filter: CompanyFilter = {}): Promise<CompanyWithStats[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  return sql<CompanyWithStats[]>`
    SELECT
      c.id, c.name, c.normalized_name, c.url, c.industry, c.description,
      c.roles, c.tags, c.location, c.size, c.employee_count, c.listing_market, c.source, c.source_url,
      c.is_newgrad, c.is_game, c.has_opening, c.recruit_url, c.stock_reason,
      c.sources, c.is_smb, c.is_listed,
      c.crawled_at, c.updated_at,
      (SELECT count(*) FROM company_interview_articles a WHERE a.company_id = c.id) AS article_count,
      CASE WHEN EXISTS(SELECT 1 FROM company_newgrad_role_images r WHERE r.company_id = c.id)
           THEN TRUE ELSE FALSE END AS has_newgrad_image,
      CASE WHEN EXISTS(SELECT 1 FROM company_profiles p WHERE p.company_id = c.id)
           THEN TRUE ELSE FALSE END AS has_profile
    FROM companies c
    ${companyFilterSql(filter)}
    ORDER BY c.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

function companyFilterSql(filter: CompanyFilter) {
  const like = filter.q ? '%' + filter.q + '%' : '';
  return sql`
    WHERE TRUE
      ${filter.role ? (isSqlite ? sql`AND EXISTS (SELECT 1 FROM json_each(c.roles) WHERE value = ${filter.role})` : sql`AND ${filter.role} = ANY(c.roles)`) : sql``}
      ${filter.tag ? (isSqlite ? sql`AND EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value = ${filter.tag})` : sql`AND ${filter.tag} = ANY(c.tags)`) : sql``}
      ${filter.industry ? sql`AND c.industry = ${filter.industry}` : sql``}
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
  /** 中小フラグ (spec/companies/listing-bundle.md §2③)。 */
  isSMB?: boolean;
  /** 上場シグナル (中小判定の材料)。 */
  isListed?: boolean;
  recruitUrl?: string;
  stockReason?: string;
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
       is_newgrad, is_game, has_opening, recruit_url, stock_reason, sources, is_smb, is_listed)
    VALUES (
      ${c.name}, ${c.normalized_name}, ${c.url}, ${c.industry}, ${c.description},
      ${c.roles}, ${c.tags}, ${c.location}, ${c.size},
      ${c.employee_count}, ${c.listing_market}, ${c.source}, ${c.source_url},
      ${isNewgrad}, ${isGame}, ${hasOpening}, ${recruitUrl}, ${stockReason},
      ${sql.json(merged)}, ${isSMB}, ${isListed}
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
      is_listed   = companies.is_listed OR EXCLUDED.is_listed,
      -- is_smb は「最終的な従業員数」から純粋導出 (不明=0 も中小)。 SMB_EMPLOYEE_MAX=300。
      is_smb      = CASE WHEN (CASE WHEN EXCLUDED.employee_count > 0 THEN EXCLUDED.employee_count ELSE companies.employee_count END) <= 300 THEN TRUE ELSE FALSE END,
      updated_at  = now()
  `;
  return wasPresent ? 'updated' : 'inserted';
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
