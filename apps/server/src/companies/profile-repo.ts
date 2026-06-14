import { sql } from '../db/index.js';
import type { CompanyProfile, CompanyProfileInput } from '@tirocinium/companies';

// 遅延評価: sql は initSql() 後にしか呼べない (module-load 時点では未初期化)。
const selectCols = () => sql`company_id, philosophy, "values", ir_summary, business, sources, fetched_at`;

export async function getProfile(companyId: string): Promise<CompanyProfile | null> {
  const rows = await sql<CompanyProfile[]>`
    SELECT ${selectCols()} FROM company_profiles WHERE company_id = ${companyId}
  `;
  return rows[0] ?? null;
}

/** 企業サイト巡回結果を upsert する (1:1)。 */
export async function upsertProfile(
  companyId: string,
  p: CompanyProfileInput,
): Promise<CompanyProfile> {
  const rows = await sql<CompanyProfile[]>`
    INSERT INTO company_profiles (company_id, philosophy, "values", ir_summary, business, sources, fetched_at)
    VALUES (
      ${companyId}, ${p.philosophy ?? ''}, ${sql.json(p.values ?? [])},
      ${p.ir_summary ?? ''}, ${p.business ?? ''}, ${sql.json(p.sources ?? [])}, now()
    )
    ON CONFLICT (company_id) DO UPDATE SET
      philosophy = EXCLUDED.philosophy,
      "values"   = EXCLUDED."values",
      ir_summary = EXCLUDED.ir_summary,
      business   = EXCLUDED.business,
      sources    = EXCLUDED.sources,
      fetched_at = now()
    RETURNING ${selectCols()}
  `;
  return rows[0]!;
}
