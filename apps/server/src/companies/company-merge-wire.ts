// 英⇔カナ社名の自動マージ — 実 DB 配線層。
// company-merge-core の deps に SQL を接続し、 CLI / admin API から呼べる形にする。
// DB import は core から分離してここに置く。 spec/companies/game-graph.md §5.5。

import { sql, isSqlite } from '../db/index.js';
import { coerceSources } from '@tirocinium/companies';
import { runDuplicateMerge, type MergeSummary, type DuplicateGroup } from './company-merge-core.js';
import type { SurvivorFieldPatch } from '@tirocinium/companies';
import type { Company } from '@tirocinium/companies';

// ── 重複グループ取得 ───────────────────────────────────────────────────────

/** getDuplicateGroups の行型 (Company + 集計カウント文字列)。 */
type CompanyDupRow = Omit<Company, 'sources'> & {
  sources: unknown;
  game_count: string;
  ob_count: string;
};

/** corporate_number が同じ複数行を重複グループとして返す。 空文字は除外。 */
async function getDuplicateGroups(): Promise<DuplicateGroup[]> {
  // 重複 corporate_number を持つ companies を全件取得
  const rows = await sql<CompanyDupRow[]>`
    SELECT
      c.id, c.name, c.normalized_name, c.url, c.industry, c.description,
      c.roles, c.tags, c.location, c.size, c.employee_count, c.listing_market,
      c.source, c.source_url, c.is_newgrad, c.is_game, c.has_opening,
      c.recruit_url, c.stock_reason, c.sources, c.is_smb, c.is_listed,
      c.corporate_number, c.crawled_at, c.updated_at,
      (SELECT count(*) FROM company_game cg WHERE cg.company_id = c.id)::text AS game_count,
      (SELECT count(*) FROM company_ob_placement op WHERE op.company_id = c.id)::text AS ob_count
    FROM companies c
    WHERE c.corporate_number <> ''
      AND c.corporate_number IN (
        SELECT corporate_number FROM companies
        WHERE corporate_number <> ''
        GROUP BY corporate_number
        HAVING count(*) >= 2
      )
    ORDER BY c.corporate_number, c.id
  `;

  // グループごとに分類
  const byCorpNum = new Map<string, CompanyDupRow[]>();
  for (const row of rows) {
    const cn = row.corporate_number;
    if (!byCorpNum.has(cn)) byCorpNum.set(cn, []);
    byCorpNum.get(cn)!.push(row);
  }

  const groups: DuplicateGroup[] = [];
  for (const [corporateNumber, members] of byCorpNum) {
    groups.push({
      corporateNumber,
      candidates: members.map((m) => ({
        id: m.id,
        url: m.url,
        description: m.description,
        crawled_at: m.crawled_at,
        gameCount: Number(m.game_count),
        obCount: Number(m.ob_count),
        company: {
          ...m,
          sources: coerceSources(m.sources),
        },
      })),
    });
  }
  return groups;
}

// ── 子テーブル repoint ─────────────────────────────────────────────────────

/**
 * dupId を survivorId に repoint する (全子テーブル)。
 * PK 衝突回避のため「INSERT ... SELECT ... ON CONFLICT ... → DELETE dup」イディオムを使う。
 * @returns repoint した子テーブル行の合計。
 */
async function repointAll(dupId: string, survivorId: string): Promise<number> {
  let total = 0;

  // company_profiles (PK=company_id・1社1行)。 'values' は予約語なので引用する。
  await sql`
    INSERT INTO company_profiles (company_id, philosophy, "values", ir_summary, business, sources, fetched_at)
    SELECT ${survivorId}, philosophy, "values", ir_summary, business, sources, fetched_at
    FROM company_profiles WHERE company_id = ${dupId}
    ON CONFLICT (company_id) DO NOTHING
  `;
  const dp = await sql`DELETE FROM company_profiles WHERE company_id = ${dupId}`;
  total += Number((dp as unknown as { count?: number }).count ?? 0);

  // company_newgrad_images (PK=company_id・1社1行)
  await sql`
    INSERT INTO company_newgrad_images (company_id, summary, themes, sources, article_count, model, fetched_at)
    SELECT ${survivorId}, summary, themes, sources, article_count, model, fetched_at
    FROM company_newgrad_images WHERE company_id = ${dupId}
    ON CONFLICT (company_id) DO NOTHING
  `;
  const dni = await sql`DELETE FROM company_newgrad_images WHERE company_id = ${dupId}`;
  total += Number((dni as unknown as { count?: number }).count ?? 0);

  // company_newgrad_role_images (PK=(company_id, role))
  await sql`
    INSERT INTO company_newgrad_role_images (company_id, role, summary, themes, article_count, model, fetched_at)
    SELECT ${survivorId}, role, summary, themes, article_count, model, fetched_at
    FROM company_newgrad_role_images WHERE company_id = ${dupId}
    ON CONFLICT (company_id, role) DO NOTHING
  `;
  const dnri = await sql`DELETE FROM company_newgrad_role_images WHERE company_id = ${dupId}`;
  total += Number((dnri as unknown as { count?: number }).count ?? 0);

  // company_interview_articles (UNIQUE=(company_id, normalized_url))
  await sql`
    INSERT INTO company_interview_articles (company_id, url, normalized_url, title, body, source, fetched_at)
    SELECT ${survivorId}, url, normalized_url, title, body, source, fetched_at
    FROM company_interview_articles WHERE company_id = ${dupId}
    ON CONFLICT (company_id, normalized_url) DO NOTHING
  `;
  const dia = await sql`DELETE FROM company_interview_articles WHERE company_id = ${dupId}`;
  total += Number((dia as unknown as { count?: number }).count ?? 0);

  // company_game (PK=(company_id, game_id, role))
  await sql`
    INSERT INTO company_game (company_id, game_id, role, source)
    SELECT ${survivorId}, game_id, role, source
    FROM company_game WHERE company_id = ${dupId}
    ON CONFLICT (company_id, game_id, role) DO NOTHING
  `;
  const dcg = await sql`DELETE FROM company_game WHERE company_id = ${dupId}`;
  total += Number((dcg as unknown as { count?: number }).count ?? 0);

  // company_tech (PK=(company_id, tech_id))
  await sql`
    INSERT INTO company_tech (company_id, tech_id, source)
    SELECT ${survivorId}, tech_id, source
    FROM company_tech WHERE company_id = ${dupId}
    ON CONFLICT (company_id, tech_id) DO NOTHING
  `;
  const dct = await sql`DELETE FROM company_tech WHERE company_id = ${dupId}`;
  total += Number((dct as unknown as { count?: number }).count ?? 0);

  // company_ob_placement (PK=(company_id, join_year, class_name, role)・headcount 合算)
  await sql`
    INSERT INTO company_ob_placement (company_id, join_year, class_name, role, headcount, source, updated_at)
    SELECT ${survivorId}, join_year, class_name, role, headcount, source, updated_at
    FROM company_ob_placement WHERE company_id = ${dupId}
    ON CONFLICT (company_id, join_year, class_name, role) DO UPDATE SET
      headcount  = company_ob_placement.headcount + EXCLUDED.headcount,
      updated_at = EXCLUDED.updated_at
  `;
  const dop = await sql`DELETE FROM company_ob_placement WHERE company_id = ${dupId}`;
  total += Number((dop as unknown as { count?: number }).count ?? 0);

  // company_partner (company_id と partner_id の両方を repoint)
  // 自己ループ (company_id = partner_id になる行) は CHECK 違反→除外。
  await sql`
    INSERT INTO company_partner (company_id, partner_id, kind, source)
    SELECT
      CASE WHEN company_id = ${dupId} THEN ${survivorId} ELSE company_id END,
      CASE WHEN partner_id = ${dupId} THEN ${survivorId} ELSE partner_id END,
      kind, source
    FROM company_partner
    WHERE (company_id = ${dupId} OR partner_id = ${dupId})
      -- 置換後に自己ループになる行は除外 (CHECK company_id <> partner_id)
      AND NOT (
        (CASE WHEN company_id = ${dupId} THEN ${survivorId} ELSE company_id END)
        = (CASE WHEN partner_id = ${dupId} THEN ${survivorId} ELSE partner_id END)
      )
    ON CONFLICT (company_id, partner_id, kind) DO NOTHING
  `;
  const dcp = await sql`DELETE FROM company_partner WHERE company_id = ${dupId} OR partner_id = ${dupId}`;
  total += Number((dcp as unknown as { count?: number }).count ?? 0);

  return total;
}

// ── survivor フィールド更新 ────────────────────────────────────────────────

async function applySurvivorFields(survivorId: string, patch: SurvivorFieldPatch): Promise<void> {
  await sql`
    UPDATE companies SET
      sources        = ${sql.json(patch.sources)},
      is_newgrad     = ${patch.is_newgrad},
      is_game        = ${patch.is_game},
      has_opening    = ${patch.has_opening},
      is_smb         = ${patch.is_smb},
      is_listed      = ${patch.is_listed},
      url            = COALESCE(NULLIF(${patch.url}, ''), url),
      description    = COALESCE(NULLIF(${patch.description}, ''), description),
      industry       = COALESCE(NULLIF(${patch.industry}, ''), industry),
      location       = COALESCE(NULLIF(${patch.location}, ''), location),
      size           = COALESCE(NULLIF(${patch.size}, ''), size),
      recruit_url    = COALESCE(NULLIF(${patch.recruit_url}, ''), recruit_url),
      listing_market = COALESCE(NULLIF(${patch.listing_market}, ''), listing_market),
      corporate_number = COALESCE(NULLIF(${patch.corporate_number}, ''), corporate_number),
      stock_reason   = COALESCE(NULLIF(${patch.stock_reason}, ''), stock_reason),
      updated_at     = now()
    WHERE id = ${survivorId}
  `;
}

// ── loser 削除 ────────────────────────────────────────────────────────────

async function deleteCompany(id: string): Promise<void> {
  await sql`DELETE FROM companies WHERE id = ${id}`;
}

// ── 公開エントリポイント ──────────────────────────────────────────────────

/**
 * corporate_number が同じ重複企業を 1 行にマージする。
 * CLI および admin API から呼ぶ。
 * @param opts.dryRun true なら差分を算出するが DB に反映しない。
 */
export function mergeDuplicateCompanies(opts: { dryRun?: boolean } = {}): Promise<MergeSummary> {
  return runDuplicateMerge({
    getDuplicateGroups,
    repointAll,
    applySurvivorFields,
    deleteCompany,
    dryRun: opts.dryRun,
  });
}
