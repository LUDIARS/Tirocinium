import { sql } from '../db/index.js';

export type FtLoopRun = {
  id: string;
  interviewer_id: string;
  examinee_id: string;
  session_id: string;
  started_at: Date;
  ended_at: Date | null;
  status: 'running' | 'completed' | 'aborted';
  human_review_done: boolean;
  metadata: Record<string, unknown>;
};

export async function startRun(opts: {
  interviewer_id: string;
  examinee_id: string;
  session_id: string;
  metadata?: Record<string, unknown>;
}): Promise<FtLoopRun> {
  const rows = await sql<FtLoopRun[]>`
    INSERT INTO ft_loop_runs (interviewer_id, examinee_id, session_id, status, metadata)
    VALUES (
      ${opts.interviewer_id}, ${opts.examinee_id}, ${opts.session_id},
      'running', ${sql.json((opts.metadata ?? {}) as never)}
    )
    RETURNING *
  `;
  return rows[0]!;
}

export async function completeRun(id: string): Promise<void> {
  await sql`
    UPDATE ft_loop_runs
       SET status = 'completed', ended_at = now()
     WHERE id = ${id}
  `;
}

export async function abortRun(id: string): Promise<void> {
  await sql`
    UPDATE ft_loop_runs
       SET status = 'aborted', ended_at = now()
     WHERE id = ${id}
  `;
}

export async function getRun(id: string): Promise<FtLoopRun | null> {
  const rows = await sql<FtLoopRun[]>`
    SELECT * FROM ft_loop_runs WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function listRecentRuns(limit = 50): Promise<FtLoopRun[]> {
  return sql<FtLoopRun[]>`
    SELECT * FROM ft_loop_runs ORDER BY started_at DESC LIMIT ${limit}
  `;
}

export async function markHumanReviewed(id: string): Promise<void> {
  await sql`UPDATE ft_loop_runs SET human_review_done = true WHERE id = ${id}`;
}
