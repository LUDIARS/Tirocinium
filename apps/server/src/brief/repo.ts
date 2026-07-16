// interview_briefs の永続化 (migration 024)。
// ブリーフはセッション前にコンパイルされセッション中は不変 (spec §5) —
// 既存行があれば上書きせずそれを返す (再接続で入力が揺れない)。

import { sql } from '../db/index.js';

export type StoredBrief = {
  body_md: string;
  source_meta: Record<string, unknown>;
  seed: number;
};

function asObject(v: unknown): Record<string, unknown> {
  const obj = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return obj && typeof obj === 'object' && !Array.isArray(obj)
    ? (obj as Record<string, unknown>)
    : {};
}

export async function getBrief(sessionId: string): Promise<StoredBrief | null> {
  const rows = await sql<{ body_md: string; source_meta: unknown; seed: number | string }[]>`
    SELECT body_md, source_meta, seed FROM interview_briefs WHERE session_id = ${sessionId}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    body_md: r.body_md,
    source_meta: asObject(r.source_meta),
    seed: Number(r.seed),
  };
}

/** 既存行がある場合は挿入せず既存を返す (不変原則)。 */
export async function saveBriefIfAbsent(
  sessionId: string,
  bodyMd: string,
  sourceMeta: Record<string, unknown>,
  seed: number,
): Promise<StoredBrief> {
  const existing = await getBrief(sessionId);
  if (existing) return existing;
  await sql`
    INSERT INTO interview_briefs (session_id, body_md, source_meta, seed)
    VALUES (${sessionId}, ${bodyMd}, ${sql.json(sourceMeta as never)}, ${seed})
    ON CONFLICT (session_id) DO NOTHING
  `;
  // 競合 (並行 init) でも必ず永続化済みの実体を返す
  const stored = await getBrief(sessionId);
  if (!stored) throw new Error(`interview_briefs の保存に失敗 (session=${sessionId})`);
  return stored;
}
