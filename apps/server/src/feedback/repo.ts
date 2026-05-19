import { sql } from '../db/index.js';

export type FeedbackAction = 'accept' | 'reject' | 'edit' | 'skip';

export type FeedbackTargetKind =
  | 'summary_block'
  | 'growth_hint'
  | 'rag_ref'
  | 'ai_critique'
  | 'evaluation_axis';

export type HumanFeedbackRecord = {
  id: number;
  user_id: string;
  target_kind: FeedbackTargetKind;
  target_id: string;
  action: FeedbackAction;
  edit_payload: unknown;
  reason: string | null;
  created_at: Date;
};

export type FeedbackInput = {
  user_id: string;
  target_kind: FeedbackTargetKind;
  target_id: string;
  action: FeedbackAction;
  edit_payload?: unknown;
  reason?: string;
};

export async function appendFeedback(f: FeedbackInput): Promise<HumanFeedbackRecord> {
  const payload = f.edit_payload === undefined ? null : (sql.json(f.edit_payload as never));
  const rows = await sql<HumanFeedbackRecord[]>`
    INSERT INTO human_feedback (user_id, target_kind, target_id, action, edit_payload, reason)
    VALUES (
      ${f.user_id}, ${f.target_kind}, ${f.target_id}, ${f.action},
      ${payload},
      ${f.reason ?? null}
    )
    RETURNING *
  `;
  return rows[0]!;
}

export async function listFeedbackForSession(sessionId: string, userId: string): Promise<HumanFeedbackRecord[]> {
  // target_id が session の場合と summary id の場合があるが、
  // 簡易には target_id が session を含むものを返す
  return sql<HumanFeedbackRecord[]>`
    SELECT * FROM human_feedback
    WHERE user_id = ${userId}
      AND (target_id = ${sessionId} OR target_id LIKE ${sessionId + ':%'})
    ORDER BY created_at DESC
  `;
}

export async function listMyFeedback(userId: string, limit = 100): Promise<HumanFeedbackRecord[]> {
  return sql<HumanFeedbackRecord[]>`
    SELECT * FROM human_feedback
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}
