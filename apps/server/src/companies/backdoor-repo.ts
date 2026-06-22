// 卒業生「裏口」: 自己投稿エントリ + マジックリンク/セッション token の永続化。 migration 019。
// 本人が同意して書く自己申告データ (harvest した PII ではない)。 Discord identity をアンカーにする。
// Cernere ではなく Discord (Bot B) 認証で本人確認する (Discutere と同じ Cernere 非依存方針)。
//
// 時刻比較の注意: SQLite の datetime('now') は 'YYYY-MM-DD HH:MM:SS' (space) だが JS の ISO は
// 'YYYY-MM-DDTHH:MM:SS.sssZ' (T) で字句順比較が不整合になる。 token 期限の判定は SQL の now() に
// 依存せず、 比較・保存とも JS の Date を渡して JS 側 (new Date(...) 比較) で判定する。

import { randomBytes } from 'node:crypto';
import { sql } from '../db/index.js';
import { normalizeName } from '@tirocinium/companies';

export type BackdoorEntry = {
  id: string;
  discord_user_id: string;
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
  discord_user_id: string;
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
    discord_user_id: row.discord_user_id,
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

/** 指定 Discord ユーザのエントリを取得する。 未登録なら null。 */
export async function getEntry(discordUserId: string): Promise<BackdoorEntry | null> {
  const rows = await sql<EntryRow[]>`
    SELECT id, discord_user_id, display_name, current_company, current_company_id,
           message_to_students, message_to_industry, students_published, industry_published, updated_at FROM backdoor_alumni WHERE discord_user_id = ${discordUserId}
  `;
  return rows[0] ? mapEntry(rows[0]) : null;
}

/**
 * エントリを部分更新で upsert する。 未指定パッチは既存値 (なければ既定) を維持する。
 * current_company が変わるたび current_company_id を再解決する。
 */
export async function upsertEntry(
  discordUserId: string,
  fallbackDisplayName: string,
  patch: BackdoorPatch,
): Promise<BackdoorEntry> {
  const cur = await getEntry(discordUserId);
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
      discord_user_id, display_name, current_company, current_company_id,
      message_to_students, message_to_industry, students_published, industry_published, updated_at
    ) VALUES (
      ${discordUserId}, ${next.display_name}, ${next.current_company}, ${companyId},
      ${next.message_to_students}, ${next.message_to_industry},
      ${next.students_published}, ${next.industry_published}, ${new Date()}
    )
    ON CONFLICT (discord_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      current_company = excluded.current_company,
      current_company_id = excluded.current_company_id,
      message_to_students = excluded.message_to_students,
      message_to_industry = excluded.message_to_industry,
      students_published = excluded.students_published,
      industry_published = excluded.industry_published,
      updated_at = excluded.updated_at
    RETURNING id, discord_user_id, display_name, current_company, current_company_id,
           message_to_students, message_to_industry, students_published, industry_published, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('backdoor upsert returned no row');
  return mapEntry(row);
}

/** 本人がエントリを削除する。 */
export async function deleteEntry(discordUserId: string): Promise<void> {
  await sql`DELETE FROM backdoor_alumni WHERE discord_user_id = ${discordUserId}`;
}

/** 学生向けに公開されたメッセージ (本体の「卒業生からのメッセージ」面に出す)。 */
export async function listStudentMessages(): Promise<BackdoorEntry[]> {
  const rows = await sql<EntryRow[]>`
    SELECT id, discord_user_id, display_name, current_company, current_company_id,
           message_to_students, message_to_industry, students_published, industry_published, updated_at FROM backdoor_alumni
    WHERE students_published = ${true} AND message_to_students <> ''
    ORDER BY updated_at DESC
  `;
  return rows.map(mapEntry);
}

/** 業界向けに公開されたメッセージ (裏口面に出す)。 */
export async function listIndustryMessages(): Promise<BackdoorEntry[]> {
  const rows = await sql<EntryRow[]>`
    SELECT id, discord_user_id, display_name, current_company, current_company_id,
           message_to_students, message_to_industry, students_published, industry_published, updated_at FROM backdoor_alumni
    WHERE industry_published = ${true} AND message_to_industry <> ''
    ORDER BY updated_at DESC
  `;
  return rows.map(mapEntry);
}

// ---- マジックリンク / セッション token ----

type TokenRow = {
  token: string;
  kind: string;
  discord_user_id: string;
  display_name: string;
  expires_at: string;
  used_at: string | null;
};

function newToken(): string {
  return randomBytes(24).toString('hex');
}

/** Bot B が DM で配るワンタイム link token を発行する。 */
export async function issueLinkToken(
  discordUserId: string,
  displayName: string,
  ttlMin: number,
): Promise<string> {
  const token = newToken();
  const expires = new Date(Date.now() + ttlMin * 60_000);
  await sql`
    INSERT INTO backdoor_tokens (token, kind, discord_user_id, display_name, expires_at)
    VALUES (${token}, 'link', ${discordUserId}, ${displayName}, ${expires})
  `;
  return token;
}

/**
 * link token を検証し、 有効なら session token に交換する (link は used_at で再利用不可に)。
 * 交換と同時にエントリの存在を保証して返す。 無効/期限切れ/使用済みは null。
 */
export async function exchangeLinkToken(
  token: string,
  sessionTtlMin: number,
): Promise<{ session: string; entry: BackdoorEntry } | null> {
  const now = new Date();
  const rows = await sql<TokenRow[]>`
    SELECT token, kind, discord_user_id, display_name, expires_at, used_at
    FROM backdoor_tokens WHERE token = ${token} AND kind = ${'link'}
  `;
  const row = rows[0];
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at) <= now) return null;

  await sql`UPDATE backdoor_tokens SET used_at = ${now} WHERE token = ${token}`;

  const session = newToken();
  const sExpires = new Date(now.getTime() + sessionTtlMin * 60_000);
  await sql`
    INSERT INTO backdoor_tokens (token, kind, discord_user_id, display_name, expires_at)
    VALUES (${session}, 'session', ${row.discord_user_id}, ${row.display_name}, ${sExpires})
  `;

  const entry = await upsertEntry(row.discord_user_id, row.display_name, {});
  return { session, entry };
}

/** session token を検証する。 有効なら本人の identity を返す。 */
export async function verifySession(
  token: string,
): Promise<{ discordUserId: string; displayName: string } | null> {
  const rows = await sql<TokenRow[]>`
    SELECT discord_user_id, display_name, expires_at FROM backdoor_tokens
    WHERE token = ${token} AND kind = ${'session'}
  `;
  const row = rows[0];
  if (!row || new Date(row.expires_at) <= new Date()) return null;
  return { discordUserId: row.discord_user_id, displayName: row.display_name };
}

/** 期限切れ token を掃除する (任意呼び出し)。 */
export async function purgeExpiredTokens(): Promise<void> {
  await sql`DELETE FROM backdoor_tokens WHERE expires_at <= ${new Date()}`;
}

/** 指定 company_id に勤める OB の Discord user id 一覧 (ES相談通知用)。 */
export async function listObsForCompany(
  companyId: string,
): Promise<{ discord_user_id: string; display_name: string }[]> {
  return sql<{ discord_user_id: string; display_name: string }[]>`
    SELECT discord_user_id, display_name
    FROM backdoor_alumni
    WHERE current_company_id = ${companyId}
  `;
}
