import { sql } from '../db/index.js';
import type { Company, NormalizedCompany } from '@tirocinium/companies';

const SELECT_COLS = sql`
  id, name, normalized_name, url, industry, description,
  roles, tags, location, size, source, source_url,
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

/** フィルタ付き企業一覧。 role/tag は配列包含、 q は name/description の部分一致。 */
export async function listCompanies(filter: CompanyFilter = {}): Promise<Company[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  return sql<Company[]>`
    SELECT ${SELECT_COLS} FROM companies
    WHERE TRUE
      ${filter.role ? sql`AND ${filter.role} = ANY(roles)` : sql``}
      ${filter.tag ? sql`AND ${filter.tag} = ANY(tags)` : sql``}
      ${filter.industry ? sql`AND industry = ${filter.industry}` : sql``}
      ${filter.q ? sql`AND (name ILIKE ${'%' + filter.q + '%'} OR description ILIKE ${'%' + filter.q + '%'})` : sql``}
    ORDER BY updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function getCompany(id: string): Promise<Company | null> {
  const rows = await sql<Company[]>`SELECT ${SELECT_COLS} FROM companies WHERE id = ${id}`;
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

/**
 * normalized_name で upsert する。 既存なら空でない値だけ更新 (クロール毎の劣化を防ぐ)。
 * @returns 'inserted' | 'updated'
 */
export async function upsertCompany(c: NormalizedCompany): Promise<'inserted' | 'updated'> {
  const rows = await sql<{ inserted: boolean }[]>`
    INSERT INTO companies
      (name, normalized_name, url, industry, description, roles, tags, location, size, source, source_url)
    VALUES (
      ${c.name}, ${c.normalized_name}, ${c.url}, ${c.industry}, ${c.description},
      ${c.roles}, ${c.tags}, ${c.location}, ${c.size}, ${c.source}, ${c.source_url}
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
      updated_at  = now()
    RETURNING (xmax = 0) AS inserted
  `;
  return rows[0]?.inserted ? 'inserted' : 'updated';
}
