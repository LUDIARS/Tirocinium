// 求人ニュース (job_postings) の永続化。 migration 018。
// 公開求人情報のみ保持 (個人データ境界 §6 対象外)。 新着判定 = dedup_key の UNIQUE 競合有無。

import { sql } from '../db/index.js';
import { normalizeName } from '@tirocinium/companies';
import type { JobPostingItem } from '@tirocinium/companies';

export type StoredJobPosting = {
  id: string;
  source: string;
  kind: string;
  url: string;
  title: string;
  company_name: string;
  company_id: string | null;
  role: string;
  location: string;
  employment_type: string;
  snippet: string;
  posted_at: string;
  deadline: string;
  first_seen_at: string;
};

/** 社名から company_id を解決する (normalized_name 突合)。 未解決は null。 */
async function resolveCompanyId(companyName: string): Promise<string | null> {
  const key = normalizeName(companyName);
  if (!key) return null;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE normalized_name = ${key} LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/**
 * 求人を冪等挿入し、 新規に挿入できた (= 既存 dedup_key と衝突しなかった) ものだけ返す。
 * 社名が DB の企業に解決できれば company_id を埋める。
 */
export async function insertNewJobPostings(items: JobPostingItem[]): Promise<StoredJobPosting[]> {
  const inserted: StoredJobPosting[] = [];
  for (const it of items) {
    const companyId = it.companyName ? await resolveCompanyId(it.companyName) : null;
    const rows = await sql<StoredJobPosting[]>`
      INSERT INTO job_postings (
        source, kind, dedup_key, url, title, company_name, company_id,
        role, location, employment_type, snippet, posted_at, deadline
      ) VALUES (
        ${it.source}, ${it.kind}, ${it.dedupKey}, ${it.url}, ${it.title}, ${it.companyName}, ${companyId},
        ${it.role}, ${it.location}, ${it.employmentType}, ${it.snippet}, ${it.postedAt}, ${it.deadline}
      )
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id, source, kind, url, title, company_name, company_id,
                role, location, employment_type, snippet, posted_at, deadline, first_seen_at
    `;
    if (rows[0]) inserted.push(rows[0]);
  }
  return inserted;
}

/** 求人一覧を新着順に取得する。 source 指定で 1 ソースに絞れる。 */
export async function listJobPostings(opts: { source?: string; limit?: number } = {}): Promise<StoredJobPosting[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const source = opts.source?.trim() || '';
  return sql<StoredJobPosting[]>`
    SELECT id, source, kind, url, title, company_name, company_id,
           role, location, employment_type, snippet, posted_at, deadline, first_seen_at
    FROM job_postings
    WHERE (${source} = '' OR source = ${source})
    ORDER BY first_seen_at DESC
    LIMIT ${limit}
  `;
}

/** 求人の総件数 (source 指定可)。 */
export async function countJobPostings(source?: string): Promise<number> {
  const s = source?.trim() || '';
  const rows = await sql<{ n: number }[]>`
    SELECT count(*) AS n FROM job_postings WHERE (${s} = '' OR source = ${s})
  `;
  return Number(rows[0]?.n ?? 0);
}

/** Nuntius 未通知の求人を取得する (通知バッチ用)。 */
export async function pendingNotifications(limit = 50): Promise<StoredJobPosting[]> {
  return sql<StoredJobPosting[]>`
    SELECT id, source, kind, url, title, company_name, company_id,
           role, location, employment_type, snippet, posted_at, deadline, first_seen_at
    FROM job_postings
    WHERE notified = ${false}
    ORDER BY first_seen_at ASC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `;
}

/** 指定 id 群を通知済みにする。 */
export async function markNotified(ids: string[]): Promise<void> {
  for (const id of ids) {
    await sql`UPDATE job_postings SET notified = ${true} WHERE id = ${id}`;
  }
}
