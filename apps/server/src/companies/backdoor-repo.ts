// 卒業生「裏口」: 自己投稿エントリの永続化。 migration 019 + 021。
// 本人が同意して書く自己申告データ (harvest した PII ではない)。 本人アンカーは Cernere の sub。
// 認証は本体/面接と同じ Cernere に統一する (旧: Discord Bot B のマジックリンク。 021 で撤去)。

import { sql } from '../db/index.js';
import { normalizeName } from '@tirocinium/companies';

export type BackdoorEntry = {
  id: string;
  cernere_user_id: string;
  display_name: string;
  current_company: string;
  current_company_id: string | null;
  message_to_students: string;
  message_to_industry: string;
  students_published: boolean;
  industry_published: boolean;
  updated_at: string;
};

/** API/コマンドから受け取る部分更新パッチ。 未指定フィールドは既存値を維持する。 */
export type BackdoorPatch = {
  display_name?: string;
  current_company?: string;
  message_to_students?: string;
  message_to_industry?: string;
  students_published?: boolean;
  industry_published?: boolean;
};

type EntryRow = {
  id: string;
  cernere_user_id: string;
  display_name: string;
  current_company: string;
  current_company_id: string | null;
  message_to_students: string;
  message_to_industry: string;
  students_published: boolean | number;
  industry_published: boolean | number;
  updated_at: string;
};

/** SQLite は bool を 0/1 で返す。 PG は true/false。 両方を boolean に正規化する。 */
function mapEntry(row: EntryRow): BackdoorEntry {
  return {
    id: row.id,
    cernere_user_id: row.cernere_user_id,
    display_name: row.display_name,
    current_company: row.current_company,
    current_company_id: row.current_company_id ?? null,
    message_to_students: row.message_to_students,
    message_to_industry: row.message_to_industry,
    students_published: Boolean(row.students_published),
    industry_published: Boolean(row.industry_published),
    updated_at: String(row.updated_at),
  };
}

/** 社名から company_id を解決する (normalized_name 突合)。 未解決は null。 job-postings-repo と同方式。 */
async function resolveCompanyId(companyName: string): Promise<string | null> {
  const key = normalizeName(companyName);
  if (!key) return null;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE normalized_name = ${key} LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/** 指定 Cernere ユーザのエントリを取得する。 未登録なら null。 */
export async function getEntry(cernereUserId: string): Promise<BackdoorEntry | null> {
  const rows = await sql<EntryRow[]>`
    SELECT id, cernere_user_id, display_name, current_company, current_company_id,
           message_to_students, message_to_industry, students_published, industry_published, updated_at FROM backdoor_alumni WHERE cernere_user_id = ${cernereUserId}
  `;
  return rows[0] ? mapEntry(rows[0]) : null;
}

/**
 * エントリを部分更新で upsert する。 未指定パッチは既存値 (なければ既定) を維持する。
 * current_company が変わるたび current_company_id を再解決する。
 */
export async function upsertEntry(
  cernereUserId: string,
  fallbackDisplayName: string,
  patch: BackdoorPatch,
): Promise<BackdoorEntry> {
  const cur = await getEntry(cernereUserId);
  const next = {
    display_name: patch.display_name ?? cur?.display_name ?? fallbackDisplayName ?? '',
    current_company: patch.current_company ?? cur?.current_company ?? '',
    message_to_students: patch.message_to_students ?? cur?.message_to_students ?? '',
    message_to_industry: patch.message_to_industry ?? cur?.message_to_industry ?? '',
    students_published: patch.students_published ?? cur?.students_published ?? false,
    industry_published: patch.industry_published ?? cur?.industry_published ?? false,
  };
  const companyId = next.current_company ? await resolveCompanyId(next.current_company) : null;

  const rows = await sql<EntryRow[]>`
    INSERT INTO backdoor_alumni (
      cernere_user_id, display_name, current_company, current_company_id,
      message_to_students, message_to_industry, students_published, industry_published, updated_at
    ) VALUES (
      ${cernereUserId}, ${next.display_name}, ${next.current_company}, ${companyId},
      ${next.message_to_students}, ${next.message_to_industry},
      ${next.students_published}, ${next.industry_published}, ${new Date()}
    )
    ON CONFLICT (cernere_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      current_company = excluded.current_company,
      current_company_id = excluded.current_company_id,
      message_to_students = excluded.message_to_students,
      message_to_industry = excluded.message_to_industry,
      students_published = excluded.students_published,
      industry_published = excluded.industry_published,
      updated_at = excluded.updated_at
    RETURNING id, cernere_user_id, display_name, current_company, current_company_id,
           message_to_students, message_to_industry, students_published, industry_published, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('backdoor upsert returned no row');
  return mapEntry(row);
}

/** 本人がエントリを削除する。 */
export async function deleteEntry(cernereUserId: string): Promise<void> {
  await sql`DELETE FROM backdoor_alumni WHERE cernere_user_id = ${cernereUserId}`;
}

/** 学生向けに公開されたメッセージ (本体の「卒業生からのメッセージ」面に出す)。 */
export async function listStudentMessages(): Promise<BackdoorEntry[]> {
  const rows = await sql<EntryRow[]>`
    SELECT id, cernere_user_id, display_name, current_company, current_company_id,
           message_to_students, message_to_industry, students_published, industry_published, updated_at FROM backdoor_alumni
    WHERE students_published = ${true} AND message_to_students <> ''
    ORDER BY updated_at DESC
  `;
  return rows.map(mapEntry);
}

/** 業界向けに公開されたメッセージ (裏口面に出す)。 */
export async function listIndustryMessages(): Promise<BackdoorEntry[]> {
  const rows = await sql<EntryRow[]>`
    SELECT id, cernere_user_id, display_name, current_company, current_company_id,
           message_to_students, message_to_industry, students_published, industry_published, updated_at FROM backdoor_alumni
    WHERE industry_published = ${true} AND message_to_industry <> ''
    ORDER BY updated_at DESC
  `;
  return rows.map(mapEntry);
}

/** 指定 company_id に勤める OB の Cernere user id 一覧 (ES相談の Nuntius 通知用)。 */
export async function listObsForCompany(
  companyId: string,
): Promise<{ cernere_user_id: string; display_name: string }[]> {
  return sql<{ cernere_user_id: string; display_name: string }[]>`
    SELECT cernere_user_id, display_name
    FROM backdoor_alumni
    WHERE current_company_id = ${companyId}
  `;
}
