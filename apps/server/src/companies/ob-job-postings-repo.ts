// OB が投稿する求人の永続化。 migration 020 + 021。
// posted_by_cernere_user_id は内部管理のみ。 在校生向け API / 公開 API には返さない。

import { sql } from '../db/index.js';
import { normalizeName } from '@tirocinium/companies';

export type ObJobPosting = {
  id: string;
  title: string;
  role: string;
  description: string;
  company_name: string;
  company_id: string | null;
  location: string;
  employment_type: string;
  deadline: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ObJobPostingWithOwner = ObJobPosting & { is_mine: boolean };

export type ObJobPatch = {
  title?: string;
  role?: string;
  description?: string;
  company_name?: string;
  location?: string;
  employment_type?: string;
  deadline?: string;
  is_active?: boolean;
};

type PostingRow = {
  id: string;
  posted_by_cernere_user_id: string;
  title: string;
  role: string;
  description: string;
  company_name: string;
  company_id: string | null;
  location: string;
  employment_type: string;
  deadline: string;
  is_active: boolean | number;
  created_at: string;
  updated_at: string;
};

function mapPosting(row: PostingRow): ObJobPosting {
  return {
    id: row.id,
    title: row.title,
    role: row.role,
    description: row.description,
    company_name: row.company_name,
    company_id: row.company_id ?? null,
    location: row.location,
    employment_type: row.employment_type,
    deadline: row.deadline,
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

async function resolveCompanyId(companyName: string): Promise<string | null> {
  const key = normalizeName(companyName);
  if (!key) return null;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE normalized_name = ${key} LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/** 求人を新規作成する。 */
export async function insertObJobPosting(
  cernereUserId: string,
  patch: ObJobPatch,
): Promise<ObJobPosting> {
  const companyId = patch.company_name ? await resolveCompanyId(patch.company_name) : null;
  const rows = await sql<PostingRow[]>`
    INSERT INTO ob_job_postings (
      posted_by_cernere_user_id, title, role, description,
      company_name, company_id, location, employment_type,
      deadline, is_active, updated_at
    ) VALUES (
      ${cernereUserId}, ${patch.title ?? ''}, ${patch.role ?? ''},
      ${patch.description ?? ''}, ${patch.company_name ?? ''},
      ${companyId}, ${patch.location ?? ''}, ${patch.employment_type ?? ''},
      ${patch.deadline ?? ''}, ${patch.is_active !== false},
      ${new Date()}
    )
    RETURNING id, posted_by_cernere_user_id, title, role, description,
              company_name, company_id, location, employment_type,
              deadline, is_active, created_at, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('ob_job_postings insert returned no row');
  return mapPosting(row);
}

/** 投稿者のみ更新できる。 投稿者不一致なら null を返す。 */
export async function updateObJobPosting(
  id: string,
  cernereUserId: string,
  patch: ObJobPatch,
): Promise<ObJobPosting | null> {
  const cur = await sql<PostingRow[]>`
    SELECT id, posted_by_cernere_user_id, title, role, description,
           company_name, company_id, location, employment_type,
           deadline, is_active, created_at, updated_at
    FROM ob_job_postings WHERE id = ${id}
  `;
  if (!cur[0] || cur[0].posted_by_cernere_user_id !== cernereUserId) return null;

  const next = {
    title: patch.title ?? cur[0].title,
    role: patch.role ?? cur[0].role,
    description: patch.description ?? cur[0].description,
    company_name: patch.company_name ?? cur[0].company_name,
    location: patch.location ?? cur[0].location,
    employment_type: patch.employment_type ?? cur[0].employment_type,
    deadline: patch.deadline ?? cur[0].deadline,
    is_active: patch.is_active !== undefined ? patch.is_active : Boolean(cur[0].is_active),
  };
  const companyId = next.company_name ? await resolveCompanyId(next.company_name) : null;

  const rows = await sql<PostingRow[]>`
    UPDATE ob_job_postings SET
      title = ${next.title}, role = ${next.role}, description = ${next.description},
      company_name = ${next.company_name}, company_id = ${companyId},
      location = ${next.location}, employment_type = ${next.employment_type},
      deadline = ${next.deadline}, is_active = ${next.is_active},
      updated_at = ${new Date()}
    WHERE id = ${id}
    RETURNING id, posted_by_cernere_user_id, title, role, description,
              company_name, company_id, location, employment_type,
              deadline, is_active, created_at, updated_at
  `;
  return rows[0] ? mapPosting(rows[0]) : null;
}

/** 投稿者のみ削除できる。 投稿者不一致なら false を返す。 */
export async function deleteObJobPosting(id: string, cernereUserId: string): Promise<boolean> {
  const rows = await sql<{ posted_by_cernere_user_id: string }[]>`
    SELECT posted_by_cernere_user_id FROM ob_job_postings WHERE id = ${id}
  `;
  if (!rows[0] || rows[0].posted_by_cernere_user_id !== cernereUserId) return false;
  await sql`DELETE FROM ob_job_postings WHERE id = ${id}`;
  return true;
}

/** OB向け: 全求人一覧 (is_active=trueのみ、自分の投稿には is_mine=true)。 */
export async function listObJobPostingsForOb(cernereUserId: string): Promise<ObJobPostingWithOwner[]> {
  const rows = await sql<PostingRow[]>`
    SELECT id, posted_by_cernere_user_id, title, role, description,
           company_name, company_id, location, employment_type,
           deadline, is_active, created_at, updated_at
    FROM ob_job_postings
    WHERE is_active = ${true}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({ ...mapPosting(r), is_mine: r.posted_by_cernere_user_id === cernereUserId }));
}

/** OB向け: 自分の投稿のみ (アクティブ/非アクティブ含む)。 */
export async function listMyObJobPostings(cernereUserId: string): Promise<ObJobPostingWithOwner[]> {
  const rows = await sql<PostingRow[]>`
    SELECT id, posted_by_cernere_user_id, title, role, description,
           company_name, company_id, location, employment_type,
           deadline, is_active, created_at, updated_at
    FROM ob_job_postings
    WHERE posted_by_cernere_user_id = ${cernereUserId}
    ORDER BY created_at DESC
  `;
  return rows.map((r) => ({ ...mapPosting(r), is_mine: true }));
}

/** 在校生向け: 有効な求人のみ、投稿者情報なし。 */
export async function listObJobPostingsPublic(): Promise<ObJobPosting[]> {
  const rows = await sql<PostingRow[]>`
    SELECT id, posted_by_cernere_user_id, title, role, description,
           company_name, company_id, location, employment_type,
           deadline, is_active, created_at, updated_at
    FROM ob_job_postings
    WHERE is_active = ${true}
    ORDER BY created_at DESC
  `;
  return rows.map(mapPosting);
}
