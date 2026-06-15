// ゲームノード + 企業↔ゲーム edge の永続化 (spec/companies/game-graph.md Phase 1)。
// upsertGame は normalized_title で冪等、 出所 (sources) を read-merge-write で累積。

import { sql } from '../db/index.js';
import { coerceSources, mergeSources, type Game, type NormalizedGame } from '@tirocinium/companies';

const gameCols = () => sql`
  id, title, normalized_title, series, platform, genre, release_year,
  source, source_url, sources, crawled_at, updated_at
`;

/** normalized_title で 1 本引く (link 用に id を得る)。 */
export async function getGameByNormalizedTitle(normalizedTitle: string): Promise<Game | null> {
  const rows = await sql<Game[]>`
    SELECT ${gameCols()} FROM games WHERE normalized_title = ${normalizedTitle}
  `;
  return rows[0] ?? null;
}

/**
 * normalized_title で upsert する。 既存なら空でない値だけ更新 (非劣化)、 出所は累積。
 * @returns 'inserted' | 'updated'
 */
export async function upsertGame(g: NormalizedGame): Promise<'inserted' | 'updated'> {
  const existing = await sql<{ sources: unknown }[]>`
    SELECT sources FROM games WHERE normalized_title = ${g.normalized_title}
  `;
  const wasPresent = existing.length > 0;
  const merged = mergeSources(
    wasPresent ? coerceSources(existing[0]?.sources) : [],
    [{ source: g.source, url: g.source_url }],
  );
  await sql`
    INSERT INTO games
      (title, normalized_title, series, platform, genre, release_year, source, source_url, sources)
    VALUES (
      ${g.title}, ${g.normalized_title}, ${g.series}, ${g.platform}, ${g.genre},
      ${g.release_year}, ${g.source}, ${g.source_url}, ${sql.json(merged)}
    )
    ON CONFLICT (normalized_title) DO UPDATE SET
      title        = EXCLUDED.title,
      series       = COALESCE(NULLIF(EXCLUDED.series, ''), games.series),
      platform     = COALESCE(NULLIF(EXCLUDED.platform, ''), games.platform),
      genre        = COALESCE(NULLIF(EXCLUDED.genre, ''), games.genre),
      release_year = CASE WHEN EXCLUDED.release_year > 0 THEN EXCLUDED.release_year ELSE games.release_year END,
      source       = EXCLUDED.source,
      source_url   = COALESCE(NULLIF(EXCLUDED.source_url, ''), games.source_url),
      sources      = EXCLUDED.sources,
      updated_at   = now()
  `;
  return wasPresent ? 'updated' : 'inserted';
}

/** 企業↔ゲーム edge を張る (company_id, game_id, role で冪等)。 */
export async function linkCompanyGame(
  companyId: string,
  gameId: string,
  role: string,
  source: string,
): Promise<void> {
  await sql`
    INSERT INTO company_game (company_id, game_id, role, source)
    VALUES (${companyId}, ${gameId}, ${role}, ${source})
    ON CONFLICT (company_id, game_id, role) DO UPDATE SET
      source = COALESCE(NULLIF(EXCLUDED.source, ''), company_game.source)
  `;
}

export async function countGames(): Promise<number> {
  const rows = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM games`;
  return Number(rows[0]?.count ?? 0);
}
