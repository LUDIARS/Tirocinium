// OB 就職実績 (集計のみ) の永続化と集計取得 (spec/companies/game-graph.md §3.4 / §5.3)。
// 個人レコードは持たない。 PK (company_id, join_year, class_name, role) で冪等 upsert。

import { sql } from '../db/index.js';
import { buildObSummary, type NormalizedObPlacement, type ObPlacement, type ObSummary } from '@tirocinium/companies';

/** OB 集計セルを upsert する (PK で冪等。 再取込時は headcount を上書き)。 */
export async function upsertObPlacement(
  companyId: string,
  rec: NormalizedObPlacement,
  source = 'user',
): Promise<void> {
  await sql`
    INSERT INTO company_ob_placement (company_id, join_year, class_name, role, headcount, source)
    VALUES (${companyId}, ${rec.join_year}, ${rec.class_name}, ${rec.role}, ${rec.headcount}, ${source})
    ON CONFLICT (company_id, join_year, class_name, role) DO UPDATE SET
      headcount  = EXCLUDED.headcount,
      source     = EXCLUDED.source,
      updated_at = now()
  `;
}

/** 1 社の OB 集計セルを返す (年→クラス→役職順)。 */
export async function getObPlacements(companyId: string): Promise<ObPlacement[]> {
  const rows = await sql<ObPlacement[]>`
    SELECT join_year, class_name, role, headcount, source
    FROM company_ob_placement
    WHERE company_id = ${companyId}
    ORDER BY join_year DESC, class_name, role
  `;
  return rows.map((r) => ({ ...r, join_year: Number(r.join_year), headcount: Number(r.headcount) }));
}

/** 1 社の OB 集計サマリ (total / 年別 / 役職別 / クラス別)。 */
export async function getObSummary(companyId: string): Promise<ObSummary> {
  return buildObSummary(await getObPlacements(companyId));
}

/** 全社合計の OB 規模 (セル数 / 対象社数 / 総就職者数)。 */
export async function getObTotals(): Promise<{ cells: number; companies: number; headcount: number }> {
  const rows = await sql<{ cells: string; companies: string; headcount: string }[]>`
    SELECT count(*)::text AS cells,
           count(DISTINCT company_id)::text AS companies,
           COALESCE(sum(headcount), 0)::text AS headcount
    FROM company_ob_placement
  `;
  const r = rows[0];
  return { cells: Number(r?.cells ?? 0), companies: Number(r?.companies ?? 0), headcount: Number(r?.headcount ?? 0) };
}

/** OB 就職者数の多い企業ランキング (検索表示の補助)。 */
export type ObRankRow = { id: string; name: string; ob_total: number };

export async function topCompaniesByOb(limit = 30): Promise<ObRankRow[]> {
  const lim = Math.min(Math.max(limit, 1), 200);
  const rows = await sql<ObRankRow[]>`
    SELECT c.id, c.name, COALESCE(sum(op.headcount), 0)::text AS ob_total
    FROM company_ob_placement op
    JOIN companies c ON c.id = op.company_id
    GROUP BY c.id, c.name
    ORDER BY sum(op.headcount) DESC, c.name
    LIMIT ${lim}
  `;
  return rows.map((r) => ({ ...r, ob_total: Number(r.ob_total) }));
}
