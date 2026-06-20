// OB 就職実績 (集計のみ) の永続化と集計取得 (spec/feature/companies/game-graph.md §3.4 / §5.3)。
// 個人レコードは持たない。 PK (company_id, join_year, class_name, role) で冪等 upsert。

import { sql } from '../db/index.js';
import { buildObSummary, pickRepresentativeGames, type NormalizedObPlacement, type ObPlacement, type ObSummary } from '@tirocinium/companies';
import { getGamesByCompany, type CompanyGame } from './games-repo.js';

/** upsert / delete に必要な集計セルの最小形 (company_id 解決済のため社名は不要)。 */
export type ObPlacementCell = Pick<NormalizedObPlacement, 'join_year' | 'class_name' | 'role' | 'headcount'>;

/** Sheet 同期の差分計算で使う company_id 付きセル (prev 側)。 */
export type ObCellRow = { company_id: string; join_year: number; class_name: string; role: string; headcount: number };

/** OB 集計セルを upsert する (PK で冪等。 再取込時は headcount を上書き)。 */
export async function upsertObPlacement(
  companyId: string,
  rec: ObPlacementCell,
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

/** 指定 source の全 OB セルを返す (Sheet 同期の差分計算 prev 側)。 */
export async function getObPlacementsBySource(source: string): Promise<ObCellRow[]> {
  const rows = await sql<ObCellRow[]>`
    SELECT company_id, join_year, class_name, role, headcount
    FROM company_ob_placement
    WHERE source = ${source}
  `;
  return rows.map((r) => ({ ...r, join_year: Number(r.join_year), headcount: Number(r.headcount) }));
}

/** OB 集計セルを 1 件削除する (Sheet から消えたセルの同期削除)。 */
export async function deleteObPlacement(
  companyId: string,
  joinYear: number,
  className: string,
  role: string,
): Promise<void> {
  await sql`
    DELETE FROM company_ob_placement
    WHERE company_id = ${companyId} AND join_year = ${joinYear}
      AND class_name = ${className} AND role = ${role}
  `;
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

/** OB 輩出スタジオ 1 件 (OB 累計 + 代表作)。 個人なし。 */
export type ObStudio = ObRankRow & { games: CompanyGame[] };

/**
 * OB を輩出した企業を OB 数順に並べ、 各社の代表作 (company_game) を付けて返す。
 * OB→会社 (集計) と 会社→ゲーム を結合した「OB 輩出スタジオ × 代表作」ビュー (個人照合なし・§2.1 準拠)。
 */
export async function topObStudios(limit = 20, gamesPerStudio = 4): Promise<ObStudio[]> {
  const studios = await topCompaniesByOb(limit);
  const out: ObStudio[] = [];
  for (const s of studios) {
    const games = await getGamesByCompany(s.id);
    out.push({ ...s, games: pickRepresentativeGames(games, gamesPerStudio) });
  }
  return out;
}
