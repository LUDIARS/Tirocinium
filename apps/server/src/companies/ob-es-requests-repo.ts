// ES添削相談リクエストの永続化。 migration 020 + 021。
// ES の本文・個人情報はこのテーブルに保存しない (責務は Cernere)。 Tr が持つのはマッチング履歴のみ。
// 在校生・OB とも Cernere 認証 (student_cernere_user_id / matched_ob_cernere_user_id)。
// 相手への到達通知は Nuntius (Cernere user id 宛) で行う。

import { sql } from '../db/index.js';
import { normalizeName } from '@tirocinium/companies';

export type EsRequestStatus = 'pending' | 'matched' | 'closed';

export type ObEsRequest = {
  id: string;
  student_cernere_user_id: string;
  student_display_name: string;
  student_discord_handle: string;
  target_company_name: string;
  target_company_id: string | null;
  status: EsRequestStatus;
  matched_ob_cernere_user_id: string | null;
  matched_ob_display_name: string | null;
  request_note: string;
  created_at: string;
  updated_at: string;
};

type RequestRow = {
  id: string;
  student_cernere_user_id: string;
  student_display_name: string;
  student_discord_handle: string;
  target_company_name: string;
  target_company_id: string | null;
  status: string;
  matched_ob_cernere_user_id: string | null;
  matched_ob_display_name: string | null;
  request_note: string;
  created_at: string;
  updated_at: string;
};

function mapRequest(row: RequestRow): ObEsRequest {
  return {
    id: row.id,
    student_cernere_user_id: row.student_cernere_user_id,
    student_display_name: row.student_display_name,
    student_discord_handle: row.student_discord_handle,
    target_company_name: row.target_company_name,
    target_company_id: row.target_company_id ?? null,
    status: row.status as EsRequestStatus,
    matched_ob_cernere_user_id: row.matched_ob_cernere_user_id ?? null,
    matched_ob_display_name: row.matched_ob_display_name ?? null,
    request_note: row.request_note,
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

/** 在校生が ES 相談リクエストを作成する (Cernere 認証済)。 */
export async function insertEsRequest(
  studentCernereUserId: string,
  studentDisplayName: string,
  studentDiscordHandle: string,
  targetCompanyName: string,
  requestNote: string,
): Promise<ObEsRequest> {
  const companyId = targetCompanyName ? await resolveCompanyId(targetCompanyName) : null;
  const rows = await sql<RequestRow[]>`
    INSERT INTO ob_es_requests (
      student_cernere_user_id, student_display_name, student_discord_handle,
      target_company_name, target_company_id, request_note, updated_at
    ) VALUES (
      ${studentCernereUserId}, ${studentDisplayName}, ${studentDiscordHandle},
      ${targetCompanyName}, ${companyId}, ${requestNote}, ${new Date()}
    )
    RETURNING id, student_cernere_user_id, student_display_name, student_discord_handle,
              target_company_name, target_company_id, status,
              matched_ob_cernere_user_id, matched_ob_display_name,
              request_note, created_at, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('ob_es_requests insert returned no row');
  return mapRequest(row);
}

/**
 * OB が自分の会社宛てのリクエスト一覧を取得する。
 * company_id が解決できていれば id 照合、未解決なら normalized_name で名前照合。
 */
export async function listPendingEsRequestsForOb(
  obCompanyId: string | null,
  obCompanyName: string,
): Promise<ObEsRequest[]> {
  const normalizedObName = normalizeName(obCompanyName);
  let rows: RequestRow[];

  if (obCompanyId) {
    rows = await sql<RequestRow[]>`
      SELECT id, student_cernere_user_id, student_display_name, student_discord_handle,
             target_company_name, target_company_id, status,
             matched_ob_cernere_user_id, matched_ob_display_name,
             request_note, created_at, updated_at
      FROM ob_es_requests
      WHERE status = ${'pending'} AND target_company_id = ${obCompanyId}
      ORDER BY created_at ASC
    `;
  } else if (normalizedObName) {
    const allPending = await sql<RequestRow[]>`
      SELECT id, student_cernere_user_id, student_display_name, student_discord_handle,
             target_company_name, target_company_id, status,
             matched_ob_cernere_user_id, matched_ob_display_name,
             request_note, created_at, updated_at
      FROM ob_es_requests
      WHERE status = ${'pending'}
      ORDER BY created_at ASC
    `;
    rows = allPending.filter((r) => normalizeName(r.target_company_name) === normalizedObName);
  } else {
    rows = [];
  }

  return rows.map(mapRequest);
}

/**
 * OB がリクエストを引き受ける (Cernere 認証済の裏口 view 経由)。 pending のみ変更可。
 * 引き受けたら matched に変更し行を返す (在校生への Nuntius 通知用)。
 */
export async function acceptEsRequest(
  id: string,
  obCernereUserId: string,
  obDisplayName: string,
): Promise<ObEsRequest | null> {
  const rows = await sql<RequestRow[]>`
    SELECT id, student_cernere_user_id, student_display_name, student_discord_handle,
           target_company_name, target_company_id, status,
           matched_ob_cernere_user_id, matched_ob_display_name,
           request_note, created_at, updated_at
    FROM ob_es_requests
    WHERE id = ${id} AND status = ${'pending'}
  `;
  if (!rows[0]) return null;

  const updated = await sql<RequestRow[]>`
    UPDATE ob_es_requests SET
      status = ${'matched'},
      matched_ob_cernere_user_id = ${obCernereUserId},
      matched_ob_display_name = ${obDisplayName},
      updated_at = ${new Date()}
    WHERE id = ${id}
    RETURNING id, student_cernere_user_id, student_display_name, student_discord_handle,
              target_company_name, target_company_id, status,
              matched_ob_cernere_user_id, matched_ob_display_name,
              request_note, created_at, updated_at
  `;
  return updated[0] ? mapRequest(updated[0]) : null;
}

/** 在校生が自分のリクエスト一覧を取得する (Cernere 認証済)。 */
export async function listEsRequestsByStudent(studentCernereUserId: string): Promise<ObEsRequest[]> {
  const rows = await sql<RequestRow[]>`
    SELECT id, student_cernere_user_id, student_display_name, student_discord_handle,
           target_company_name, target_company_id, status,
           matched_ob_cernere_user_id, matched_ob_display_name,
           request_note, created_at, updated_at
    FROM ob_es_requests
    WHERE student_cernere_user_id = ${studentCernereUserId}
    ORDER BY created_at DESC
  `;
  return rows.map(mapRequest);
}

/** 学生 (Cernere) がリクエストをクローズする。 */
export async function closeEsRequestByStudent(
  id: string,
  studentCernereUserId: string,
): Promise<boolean> {
  const rows = await sql<{ student_cernere_user_id: string }[]>`
    SELECT student_cernere_user_id FROM ob_es_requests WHERE id = ${id}
  `;
  if (!rows[0] || rows[0].student_cernere_user_id !== studentCernereUserId) return false;
  await sql`
    UPDATE ob_es_requests SET status = ${'closed'}, updated_at = ${new Date()} WHERE id = ${id}
  `;
  return true;
}
