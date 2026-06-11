import { sql, isSqlite } from '../db/index.js';
import type { Company, NormalizedCompany } from '@tirocinium/companies';

const SELECT_COLS = sql`
  id, name, normalized_name, url, industry, description,
  roles, tags, location, size, source, source_url,
  is_newgrad, is_game, has_opening, recruit_url, stock_reason,
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
};

/** フィルタ付き企業一覧。 role/tag は配列包含、 q は name/description の部分一致。
 *  article_count (インタビュー記事数) と has_newgrad_image (新卒像サマリ有無) を付加して返す。 */
export async function listCompanies(filter: CompanyFilter = {}): Promise<CompanyWithStats[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  return sql<CompanyWithStats[]>`
    SELECT
      c.id, c.name, c.normalized_name, c.url, c.industry, c.description,
      c.roles, c.tags, c.location, c.size, c.source, c.source_url,
      c.is_newgrad, c.is_game, c.has_opening, c.recruit_url, c.stock_reason,
      c.crawled_at, c.updated_at,
      (SELECT count(*) FROM company_interview_articles a WHERE a.company_id = c.id) AS article_count,
      CASE WHEN EXISTS(SELECT 1 FROM company_newgrad_role_images r WHERE r.company_id = c.id)
           THEN TRUE ELSE FALSE END AS has_newgrad_image
    FROM companies c
    WHERE TRUE
      ${filter.role ? (isSqlite ? sql`AND EXISTS (SELECT 1 FROM json_each(c.roles) WHERE value = ${filter.role})` : sql`AND ${filter.role} = ANY(c.roles)`) : sql``}
      ${filter.tag ? (isSqlite ? sql`AND EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value = ${filter.tag})` : sql`AND ${filter.tag} = ANY(c.tags)`) : sql``}
      ${filter.industry ? sql`AND c.industry = ${filter.industry}` : sql``}
      ${filter.q ? sql`AND (c.name ILIKE ${'%' + filter.q + '%'} OR c.description ILIKE ${'%' + filter.q + '%'})` : sql``}
    ORDER BY c.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function getCompany(id: string): Promise<Company | null> {
  const rows = await sql<Company[]>`SELECT ${SELECT_COLS} FROM companies WHERE id = ${id}`;
  return rows[0] ?? null;
}

/** dedup キー (normalized_name) で 1 社引く。 upsert 直後に id を得る用途。 */
export async function getCompanyByNormalizedName(normalizedName: string): Promise<Company | null> {
  const rows = await sql<Company[]>`
    SELECT ${SELECT_COLS} FROM companies WHERE normalized_name = ${normalizedName}
  `;
  return rows[0] ?? null;
}

/** recommend 用に全件 (上限あり) を取得する。 candidate scoring 対象。 */
export async function allCompaniesForScoring(limit = 1000): Promise<Company[]> {
  return sql<Company[]>`
    SELECT ${SELECT_COLS} FROM companies
    ORDER BY updated_at DESC
    LIMIT ${Math.min(limit, 5000)}
  `;
}

export async function countCompanies(): Promise<number> {
  const rows = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM companies`;
  return Number(rows[0]?.count ?? 0);
}

/** listing 由来の発見シグナル (任意)。 既存の true は OR で温存 (sticky)。 */
export type DiscoverySignals = {
  isNewgrad?: boolean;
  isGame?: boolean;
  hasOpening?: boolean;
  recruitUrl?: string;
  stockReason?: string;
};

/**
 * normalized_name で upsert する。 既存なら空でない値だけ更新 (クロール毎の劣化を防ぐ)。
 * フラグは OR でマージし、 一度立った新卒/ゲーム/募集は温存する。
 * @returns 'inserted' | 'updated'
 */
export async function upsertCompany(
  c: NormalizedCompany,
  signals: DiscoverySignals = {},
): Promise<'inserted' | 'updated'> {
  const isNewgrad = signals.isNewgrad ?? false;
  const isGame = signals.isGame ?? false;
  const hasOpening = signals.hasOpening ?? false;
  const recruitUrl = signals.recruitUrl ?? '';
  const stockReason = signals.stockReason ?? '';
  const upsert = sql`
    INSERT INTO companies
      (name, normalized_name, url, industry, description, roles, tags, location, size, source, source_url,
       is_newgrad, is_game, has_opening, recruit_url, stock_reason)
    VALUES (
      ${c.name}, ${c.normalized_name}, ${c.url}, ${c.industry}, ${c.description},
      ${c.roles}, ${c.tags}, ${c.location}, ${c.size}, ${c.source}, ${c.source_url},
      ${isNewgrad}, ${isGame}, ${hasOpening}, ${recruitUrl}, ${stockReason}
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
      source      = EXCLUDED.source,
      source_url  = COALESCE(NULLIF(EXCLUDED.source_url, ''), companies.source_url),
      is_newgrad  = companies.is_newgrad OR EXCLUDED.is_newgrad,
      is_game     = companies.is_game OR EXCLUDED.is_game,
      has_opening = companies.has_opening OR EXCLUDED.has_opening,
      recruit_url = COALESCE(NULLIF(EXCLUDED.recruit_url, ''), companies.recruit_url),
      stock_reason= COALESCE(NULLIF(EXCLUDED.stock_reason, ''), companies.stock_reason),
      updated_at  = now()
  `;
  // SQLite は xmax を持たないので事前照会で inserted/updated を判定。 PG は xmax で 1 クエリ判定。
  if (isSqlite) {
    const existing = await sql`SELECT 1 AS e FROM companies WHERE normalized_name = ${c.normalized_name}`;
    await upsert;
    return existing.length > 0 ? 'updated' : 'inserted';
  }
  const rows = await sql<{ inserted: boolean }[]>`${upsert} RETURNING (xmax = 0) AS inserted`;
  return rows[0]?.inserted ? 'inserted' : 'updated';
}

/** enrichment 対象 (url を持ち profile 未取得) の企業を返す。 */
export async function companiesNeedingEnrichment(limit = 50): Promise<Company[]> {
  return sql<Company[]>`
    SELECT ${SELECT_COLS} FROM companies c
    WHERE c.url <> ''
      AND NOT EXISTS (SELECT 1 FROM company_profiles p WHERE p.company_id = c.id)
    ORDER BY c.updated_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `;
}
