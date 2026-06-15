// 技術ノード + 企業↔技術 edge の永続化 + プラットフォーム傾向の集約。
// spec/companies/game-graph.md (tech レイヤー)。 タグ由来は決定論、 採用ページ由来は tech-enrich (LLM)。

import { sql, isSqlite } from '../db/index.js';
import {
  normalizeTechName,
  parseTechStack,
  deriveGraphicsStyle,
  type TechToken,
} from '@tirocinium/companies';

/** tech ノードを normalized_name で upsert し id を返す。 */
export async function upsertTech(tok: TechToken): Promise<string | null> {
  const norm = normalizeTechName(tok.name);
  if (!norm) return null;
  await sql`
    INSERT INTO tech (name, normalized_name, category)
    VALUES (${tok.name}, ${norm}, ${tok.category})
    ON CONFLICT (normalized_name) DO UPDATE SET
      category = COALESCE(NULLIF(EXCLUDED.category, ''), tech.category)
  `;
  const rows = await sql<{ id: string }[]>`SELECT id FROM tech WHERE normalized_name = ${norm}`;
  return rows[0]?.id ?? null;
}

/** 企業↔技術 edge を張る (冪等)。 */
export async function linkCompanyTech(companyId: string, techId: string, source: string): Promise<void> {
  await sql`
    INSERT INTO company_tech (company_id, tech_id, source)
    VALUES (${companyId}, ${techId}, ${source})
    ON CONFLICT (company_id, tech_id) DO UPDATE SET
      source = COALESCE(NULLIF(EXCLUDED.source, ''), company_tech.source)
  `;
}

/** 1 社分のトークン列を tech node + edge にする。 張った edge 数を返す。 */
export async function applyCompanyTech(companyId: string, tokens: TechToken[], source: string): Promise<number> {
  let n = 0;
  for (const tok of tokens) {
    const id = await upsertTech(tok);
    if (id) {
      await linkCompanyTech(companyId, id, source);
      n++;
    }
  }
  return n;
}

/** 既存 companies.tags から tech グラフを構築する (決定論・無コスト)。 */
export async function buildTechFromTags(): Promise<{ companies: number; edges: number }> {
  const rows = await sql<{ id: string; tags: unknown }[]>`
    SELECT id, tags FROM companies
    WHERE ${isSqlite ? sql`tags <> '[]'` : sql`cardinality(tags) > 0`}
  `;
  let companies = 0;
  let edges = 0;
  for (const r of rows) {
    const tags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
    const tokens = parseTechStack(tags);
    if (tokens.length === 0) continue;
    edges += await applyCompanyTech(r.id, tokens, 'tags');
    companies++;
  }
  return { companies, edges };
}

/**
 * 各社のゲーム機種から is_social / primary_platform を分類する。
 * platform_class (Wikidata P400 由来) を優先し、 無ければ platform テキスト (game_kind) を補助に使う。
 */
export async function classifyCompanyPlatforms(): Promise<{ classified: number; social: number }> {
  const companies = await sql<{ id: string }[]>`SELECT id FROM companies`;
  let classified = 0;
  let social = 0;
  for (const c of companies) {
    const games = await sql<{ platform_class: string; platform: string }[]>`
      SELECT g.platform_class, g.platform
      FROM company_game cg JOIN games g ON g.id = cg.game_id
      WHERE cg.company_id = ${c.id}
    `;
    if (games.length === 0) continue;
    const counts = { mobile: 0, console: 0, pc: 0 };
    for (const g of games) {
      let cls = g.platform_class;
      if (!cls) {
        const p = g.platform ?? '';
        if (/ソーシャル|モバイル|スマホ/.test(p) && !/コンシューマ/.test(p)) cls = 'mobile';
        else if (/コンシューマ/.test(p)) cls = 'console';
      }
      if (cls === 'mobile') counts.mobile++;
      else if (cls === 'console') counts.console++;
      else if (cls === 'pc') counts.pc++;
    }
    const total = counts.mobile + counts.console + counts.pc;
    if (total === 0) continue;
    const primary =
      counts.mobile >= counts.console && counts.mobile >= counts.pc
        ? 'mobile'
        : counts.console >= counts.pc
          ? 'console'
          : 'pc';
    const isSocial = counts.mobile / total >= 0.5 && counts.mobile >= counts.console;
    await sql`
      UPDATE companies SET is_social = ${isSocial}, primary_platform = ${primary} WHERE id = ${c.id}
    `;
    classified++;
    if (isSocial) social++;
  }
  return { classified, social };
}

export type CompanyTech = { name: string; category: string };

/** 複数企業の tech プロファイルを id→tech[] で返す (検索結果への付与用)。 */
export async function getCompanyTechMap(companyIds: string[]): Promise<Map<string, CompanyTech[]>> {
  const map = new Map<string, CompanyTech[]>();
  // 件数は探索結果の上限 (数十) なので id ごとに引く (方言差のある IN(array) を避ける)。
  for (const id of companyIds) {
    const rows = await sql<{ name: string; category: string }[]>`
      SELECT t.name, t.category FROM company_tech ct JOIN tech t ON t.id = ct.tech_id
      WHERE ct.company_id = ${id}
    `;
    if (rows.length) map.set(id, rows.map((r) => ({ name: r.name, category: r.category })));
  }
  return map;
}

/** ゲームのジャンル/機種から会社のグラフィック傾向 (high/casual) を導出する (検索表示用)。 */
export async function companyGraphicsStyle(companyId: string): Promise<'' | 'high' | 'casual'> {
  const engines = (
    await sql<{ name: string }[]>`
      SELECT t.name FROM company_tech ct JOIN tech t ON t.id = ct.tech_id
      WHERE ct.company_id = ${companyId} AND t.category = 'engine'
    `
  ).map((r) => r.name);
  const rows = await sql<{ platform_class: string; genre: string }[]>`
    SELECT g.platform_class, g.genre FROM company_game cg JOIN games g ON g.id = cg.game_id
    WHERE cg.company_id = ${companyId}
  `;
  return deriveGraphicsStyle(engines, rows.map((r) => r.platform_class), rows.map((r) => r.genre));
}

export async function countTech(): Promise<{ tech: number; edges: number }> {
  const t = await sql<{ n: string }[]>`SELECT count(*)::text n FROM tech`;
  const e = await sql<{ n: string }[]>`SELECT count(*)::text n FROM company_tech`;
  return { tech: Number(t[0]?.n ?? 0), edges: Number(e[0]?.n ?? 0) };
}
