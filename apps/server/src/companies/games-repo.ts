// ゲームノード + 企業↔ゲーム edge の永続化 (spec/companies/game-graph.md Phase 1)。
// upsertGame は normalized_title で冪等、 出所 (sources) を read-merge-write で累積。

import { sql, isSqlite } from '../db/index.js';
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

// ── ゲーム→関連会社 検索 (spec/companies/game-graph.md §6) ──────────────

export type GameSearchRow = {
  id: string;
  title: string;
  series: string;
  platform: string;
  release_year: number;
  company_count: number;
};

/** タイトル部分一致でゲームを検索する (関与企業数の多い順)。 */
export async function searchGames(q: string, limit = 20): Promise<GameSearchRow[]> {
  const term = `%${q.trim()}%`;
  const lim = Math.min(Math.max(limit, 1), 50);
  const rows = await sql<GameSearchRow[]>`
    SELECT g.id, g.title, g.series, g.platform, g.release_year,
      (SELECT count(*) FROM company_game cg WHERE cg.game_id = g.id) AS company_count
    FROM games g
    WHERE ${isSqlite ? sql`g.title LIKE ${term}` : sql`g.title ILIKE ${term}`}
    ORDER BY company_count DESC, g.release_year DESC
    LIMIT ${lim}
  `;
  return rows.map((r) => ({ ...r, release_year: Number(r.release_year), company_count: Number(r.company_count) }));
}

/** 関連会社レンズの 1 社 (探索結果)。 */
export type RelatedCompany = {
  id: string;
  name: string;
  location: string;
  url: string;
  industry: string;
  is_smb: boolean;
  is_listed: boolean;
  employee_count: number;
  listing_market: string;
  is_newgrad: boolean;
  has_opening: boolean;
  recruit_url: string;
  /** direct=このゲームに直接関与 / related=作り手と他作品を共作 */
  relation: 'direct' | 'related';
  /** direct のとき: 役割 (developer/support 等) */
  role?: string;
  /** related のとき: 共作本数 と 接点ゲーム名 */
  shared_games?: number;
  via_titles?: string[];
};

export type RelatedFilters = { smb?: boolean; newgrad?: boolean; opening?: boolean; limit?: number };

// 遅延評価 (initSql 後にのみ sql を呼べる)。
const COMPANY_SEL = () => sql`
  c.id, c.name, c.location, c.url, c.industry, c.is_smb, c.is_listed,
  c.employee_count, c.listing_market, c.is_newgrad, c.has_opening, c.recruit_url
`;

const toBool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 't';

/**
 * あるゲームに「関わりたい」起点での関連会社探索。
 * - direct: そのゲームに直接関与した企業 (developer/support)。
 * - related: その作り手と "他の作品を共作" した企業 (2 ホップ、 共作本数で重み付け)。
 */
export async function relatedCompaniesByGame(
  gameId: string,
  filters: RelatedFilters = {},
): Promise<{ game: Game | null; direct: RelatedCompany[]; related: RelatedCompany[] }> {
  const game = (await sql<Game[]>`SELECT ${gameCols()} FROM games WHERE id = ${gameId}`)[0] ?? null;
  if (!game) return { game: null, direct: [], related: [] };

  const directRows = await sql<(RelatedCompany & { role: string })[]>`
    SELECT ${COMPANY_SEL()}, cg.role AS role
    FROM company_game cg JOIN companies c ON c.id = cg.company_id
    WHERE cg.game_id = ${gameId}
    ORDER BY cg.role
  `;
  const direct: RelatedCompany[] = directRows.map((r) => ({
    ...r, is_smb: toBool(r.is_smb), is_listed: toBool(r.is_listed), is_newgrad: toBool(r.is_newgrad),
    has_opening: toBool(r.has_opening), employee_count: Number(r.employee_count), relation: 'direct',
  }));

  // 作り手 (direct) が関わった "他ゲーム" を共有する企業を集め、 接点タイトルを JS で集計する。
  const pairs = await sql<(RelatedCompany & { via_title: string })[]>`
    SELECT ${COMPANY_SEL()}, g.title AS via_title
    FROM company_game cg1
    JOIN company_game cg2 ON cg2.game_id = cg1.game_id AND cg2.company_id <> cg1.company_id
    JOIN companies c ON c.id = cg2.company_id
    JOIN games g ON g.id = cg1.game_id
    WHERE cg1.company_id IN (SELECT company_id FROM company_game WHERE game_id = ${gameId})
      AND cg2.company_id NOT IN (SELECT company_id FROM company_game WHERE game_id = ${gameId})
  `;
  const byId = new Map<string, RelatedCompany>();
  for (const p of pairs) {
    let rc = byId.get(p.id);
    if (!rc) {
      rc = {
        id: p.id, name: p.name, location: p.location, url: p.url, industry: p.industry,
        is_smb: toBool(p.is_smb), is_listed: toBool(p.is_listed), employee_count: Number(p.employee_count),
        listing_market: p.listing_market, is_newgrad: toBool(p.is_newgrad), has_opening: toBool(p.has_opening),
        recruit_url: p.recruit_url, relation: 'related', shared_games: 0, via_titles: [],
      };
      byId.set(p.id, rc);
    }
    if (p.via_title && !rc.via_titles!.includes(p.via_title)) rc.via_titles!.push(p.via_title);
  }
  let related = [...byId.values()].map((r) => ({ ...r, shared_games: r.via_titles!.length }));
  if (filters.smb) related = related.filter((r) => r.is_smb);
  if (filters.newgrad) related = related.filter((r) => r.is_newgrad);
  if (filters.opening) related = related.filter((r) => r.has_opening);
  related.sort((a, b) => (b.shared_games ?? 0) - (a.shared_games ?? 0));
  const lim = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  related = related.slice(0, lim).map((r) => ({ ...r, via_titles: r.via_titles!.slice(0, 5) }));

  return { game, direct, related };
}
