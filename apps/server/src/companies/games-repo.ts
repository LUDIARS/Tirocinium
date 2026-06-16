// ゲームノード + 企業↔ゲーム edge の永続化 (spec/companies/game-graph.md Phase 1)。
// upsertGame は normalized_title で冪等、 出所 (sources) を read-merge-write で累積。

import { sql, isSqlite } from '../db/index.js';
import { coerceSources, mergeSources, normalizeSeries, type Game, type NormalizedGame } from '@tirocinium/companies';
import { getCompanyTechMap } from './tech-repo.js';

const gameCols = () => sql`
  id, title, normalized_title, series, normalized_series, platform, platform_class, genre, release_year,
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
      (title, normalized_title, series, normalized_series, platform, platform_class, genre, release_year, source, source_url, sources)
    VALUES (
      ${g.title}, ${g.normalized_title}, ${g.series}, ${g.normalized_series}, ${g.platform}, ${g.platform_class}, ${g.genre},
      ${g.release_year}, ${g.source}, ${g.source_url}, ${sql.json(merged)}
    )
    ON CONFLICT (normalized_title) DO UPDATE SET
      title          = EXCLUDED.title,
      series            = COALESCE(NULLIF(EXCLUDED.series, ''), games.series),
      normalized_series = COALESCE(NULLIF(EXCLUDED.normalized_series, ''), games.normalized_series),
      platform       = COALESCE(NULLIF(EXCLUDED.platform, ''), games.platform),
      platform_class = COALESCE(NULLIF(EXCLUDED.platform_class, ''), games.platform_class),
      genre          = COALESCE(NULLIF(EXCLUDED.genre, ''), games.genre),
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

/**
 * 既存 games の normalized_series を normalizeSeries(series) で埋め直す (#202 backfill)。
 * 変化のある行だけ UPDATE する (updated_at は触らず順序を乱さない)。 冪等。
 * @returns 更新した行数
 */
export async function backfillNormalizedSeries(): Promise<number> {
  const rows = await sql<{ id: string; series: string; normalized_series: string }[]>`
    SELECT id, series, normalized_series FROM games
  `;
  let updated = 0;
  for (const r of rows) {
    const want = normalizeSeries(r.series ?? '');
    if (want === (r.normalized_series ?? '')) continue;
    await sql`UPDATE games SET normalized_series = ${want} WHERE id = ${r.id}`;
    updated++;
  }
  return updated;
}

export async function countGames(): Promise<number> {
  const rows = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM games`;
  return Number(rows[0]?.count ?? 0);
}

/** 企業↔企業 取引先 edge を張る (company_id, partner_id, kind で冪等)。 自己参照は無視。 */
export async function linkPartner(
  companyId: string,
  partnerId: string,
  kind: string,
  source: string,
): Promise<void> {
  if (companyId === partnerId) return;
  await sql`
    INSERT INTO company_partner (company_id, partner_id, kind, source)
    VALUES (${companyId}, ${partnerId}, ${kind}, ${source})
    ON CONFLICT (company_id, partner_id, kind) DO UPDATE SET
      source = COALESCE(NULLIF(EXCLUDED.source, ''), company_partner.source)
  `;
}

export async function countCompanyGameEdges(): Promise<number> {
  const rows = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM company_game`;
  return Number(rows[0]?.count ?? 0);
}

export async function countPartnerEdges(): Promise<number> {
  const rows = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM company_partner`;
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
  is_social: boolean;
  primary_platform: string;
  /** OB 就職者数 (company_ob_placement 集計、 0=データ無し) */
  ob_total: number;
  /** 企業概要 (空文字 = 未取得) */
  description: string;
  /** IR/理念 取得済フラグ */
  has_profile: boolean;
  /** 記事数 */
  article_count: number;
  /** 最終クロール日時 */
  crawled_at: string | null;
  /** direct=このゲームに直接関与 / related=作り手と他作品を共作 */
  relation: 'direct' | 'related';
  /** direct のとき: 役割 (developer/support 等) */
  role?: string;
  /** related のとき: 共作本数 と 接点ゲーム名 */
  shared_games?: number;
  via_titles?: string[];
  /** 技術タグ (engine/language/dcc/cloud)。 検索結果に付与。 */
  tech?: string[];
};

export type RelatedFilters = {
  smb?: boolean;
  newgrad?: boolean;
  opening?: boolean;
  social?: boolean;
  /** エンジン等の技術名で絞る (部分一致、 例 'Unreal' / 'C++') */
  engine?: string;
  limit?: number;
};

// 遅延評価 (initSql 後にのみ sql を呼べる)。
const COMPANY_SEL = () => sql`
  c.id, c.name, c.location, c.url, c.industry, c.is_smb, c.is_listed,
  c.employee_count, c.listing_market, c.is_newgrad, c.has_opening, c.recruit_url,
  c.is_social, c.primary_platform, c.description, c.crawled_at,
  (SELECT COALESCE(sum(op.headcount), 0) FROM company_ob_placement op WHERE op.company_id = c.id) AS ob_total,
  (SELECT count(*) FROM company_interview_articles a WHERE a.company_id = c.id) AS article_count,
  CASE WHEN EXISTS(SELECT 1 FROM company_profiles p WHERE p.company_id = c.id)
       THEN TRUE ELSE FALSE END AS has_profile
`;

const toBool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 't';

/**
 * あるゲームに「関わりたい」起点での関連会社探索。
 * - direct: そのゲームに直接関与した企業 (developer/publisher/support)。
 * - related: 作り手と他作品を共作 / 同シリーズの開発元 / 取引先 を集約 (つながり数で重み付け)。
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
    has_opening: toBool(r.has_opening), is_social: toBool(r.is_social), employee_count: Number(r.employee_count),
    ob_total: Number(r.ob_total), has_profile: toBool(r.has_profile), article_count: Number(r.article_count ?? 0),
    description: r.description ?? '', relation: 'direct',
  }));

  const byId = new Map<string, RelatedCompany>();
  // つながり (reason) を 1 件足す。 row は COMPANY_SEL の各列を持つ。
  const addReason = (row: RelatedCompany, reason: string): void => {
    let rc = byId.get(row.id);
    if (!rc) {
      rc = {
        id: row.id, name: row.name, location: row.location, url: row.url, industry: row.industry,
        is_smb: toBool(row.is_smb), is_listed: toBool(row.is_listed), employee_count: Number(row.employee_count),
        listing_market: row.listing_market, is_newgrad: toBool(row.is_newgrad), has_opening: toBool(row.has_opening),
        is_social: toBool(row.is_social), primary_platform: row.primary_platform,
        ob_total: Number(row.ob_total),
        description: row.description ?? '', has_profile: toBool(row.has_profile),
        article_count: Number(row.article_count ?? 0), crawled_at: row.crawled_at ?? null,
        recruit_url: row.recruit_url, relation: 'related', shared_games: 0, via_titles: [],
      };
      byId.set(row.id, rc);
    }
    if (reason && !rc.via_titles!.includes(reason)) rc.via_titles!.push(reason);
  };

  // 1) 作り手と "他ゲームを共作" した企業 (2 ホップ)。
  const coDev = await sql<(RelatedCompany & { via_title: string })[]>`
    SELECT ${COMPANY_SEL()}, g.title AS via_title
    FROM company_game cg1
    JOIN company_game cg2 ON cg2.game_id = cg1.game_id AND cg2.company_id <> cg1.company_id
    JOIN companies c ON c.id = cg2.company_id
    JOIN games g ON g.id = cg1.game_id
    WHERE cg1.company_id IN (SELECT company_id FROM company_game WHERE game_id = ${gameId})
      AND cg2.company_id NOT IN (SELECT company_id FROM company_game WHERE game_id = ${gameId})
  `;
  for (const r of coDev) addReason(r, `共作: ${r.via_title}`);

  // 2) 同シリーズの他作品の開発/発売企業 (series が分かる場合)。
  // 正規化キー (normalized_series) で表記揺れ/略称/下位シリーズを束ねる。 backfill 前 (正規化キー空)
  // の行は raw series へ degrade する (検索を壊さない)。 #202。
  if (game.series) {
    const sameSeries = await sql<(RelatedCompany & { via_title: string })[]>`
      SELECT ${COMPANY_SEL()}, g2.title AS via_title
      FROM games g0
      JOIN games g2
        ON (CASE WHEN g2.normalized_series <> '' THEN g2.normalized_series ELSE g2.series END)
         = (CASE WHEN g0.normalized_series <> '' THEN g0.normalized_series ELSE g0.series END)
         AND g2.id <> g0.id
      JOIN company_game cg ON cg.game_id = g2.id
      JOIN companies c ON c.id = cg.company_id
      WHERE g0.id = ${gameId}
        AND (CASE WHEN g0.normalized_series <> '' THEN g0.normalized_series ELSE g0.series END) <> ''
        AND c.id NOT IN (SELECT company_id FROM company_game WHERE game_id = ${gameId})
    `;
    for (const r of sameSeries) addReason(r, `${game.series}シリーズ: ${r.via_title}`);
  }

  // 3) 直接関与企業の取引先 (開発元↔発売元 等)。
  const partners = await sql<RelatedCompany[]>`
    SELECT ${COMPANY_SEL()}
    FROM company_partner cp
    JOIN companies c ON c.id = cp.partner_id
    WHERE cp.company_id IN (SELECT company_id FROM company_game WHERE game_id = ${gameId})
      AND cp.partner_id NOT IN (SELECT company_id FROM company_game WHERE game_id = ${gameId})
  `;
  for (const r of partners) addReason(r, '取引先');

  let related: RelatedCompany[] = [...byId.values()].map((r) => ({ ...r, shared_games: r.via_titles!.length }));
  if (filters.smb) related = related.filter((r) => r.is_smb);
  if (filters.newgrad) related = related.filter((r) => r.is_newgrad);
  if (filters.opening) related = related.filter((r) => r.has_opening);
  if (filters.social) related = related.filter((r) => r.is_social);
  related.sort((a, b) => (b.shared_games ?? 0) - (a.shared_games ?? 0));
  related = related.slice(0, 200); // tech 付与前に候補を上限で絞る

  // 技術タグを付与 (direct + related)。 engine フィルタは tech 付与後に適用。
  const techMap = await getCompanyTechMap([...direct.map((d) => d.id), ...related.map((r) => r.id)]);
  const attach = (c: RelatedCompany): RelatedCompany => ({
    ...c, tech: (techMap.get(c.id) ?? []).map((t) => t.name),
  });
  const directOut = direct.map(attach);
  related = related.map(attach);
  if (filters.engine) {
    const needle = filters.engine.toLowerCase();
    related = related.filter((r) => (r.tech ?? []).some((t) => t.toLowerCase().includes(needle)));
  }
  const lim = Math.min(Math.max(filters.limit ?? 30, 1), 100);
  related = related.slice(0, lim).map((r) => ({ ...r, via_titles: r.via_titles!.slice(0, 5) }));

  return { game, direct: directOut, related };
}

export type CompanyGame = {
  id: string;
  title: string;
  series: string;
  platform: string;
  release_year: number;
  role: string;
};

/** 企業が関与したゲーム一覧 (company_game → games)。 */
export async function getGamesByCompany(companyId: string): Promise<CompanyGame[]> {
  const rows = await sql<CompanyGame[]>`
    SELECT g.id, g.title, g.series, g.platform, g.release_year, cg.role
    FROM company_game cg JOIN games g ON g.id = cg.game_id
    WHERE cg.company_id = ${companyId}
    ORDER BY g.release_year DESC, g.title
  `;
  return rows.map((r) => ({ ...r, release_year: Number(r.release_year) }));
}

/** 技術名 (engine/language 等) で企業を引く (技術グラフの直接クエリ)。 */
export async function companiesByTech(
  techName: string,
  filters: { smb?: boolean; social?: boolean; limit?: number } = {},
): Promise<RelatedCompany[]> {
  const lim = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const rows = await sql<RelatedCompany[]>`
    SELECT ${COMPANY_SEL()}
    FROM company_tech ct
    JOIN tech t ON t.id = ct.tech_id
    JOIN companies c ON c.id = ct.company_id
    WHERE ${isSqlite ? sql`t.name LIKE ${'%' + techName + '%'}` : sql`t.name ILIKE ${'%' + techName + '%'}`}
  `;
  let out = rows.map((r) => ({
    ...r, is_smb: toBool(r.is_smb), is_listed: toBool(r.is_listed), is_newgrad: toBool(r.is_newgrad),
    has_opening: toBool(r.has_opening), is_social: toBool(r.is_social), employee_count: Number(r.employee_count),
    ob_total: Number(r.ob_total), has_profile: toBool(r.has_profile), article_count: Number(r.article_count ?? 0),
    description: r.description ?? '', relation: 'related' as const,
  }));
  if (filters.smb) out = out.filter((r) => r.is_smb);
  if (filters.social) out = out.filter((r) => r.is_social);
  // 重複社を畳む
  const seen = new Set<string>();
  out = out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const techMap = await getCompanyTechMap(out.map((r) => r.id));
  return out.slice(0, lim).map((r) => ({ ...r, tech: (techMap.get(r.id) ?? []).map((t) => t.name) }));
}
