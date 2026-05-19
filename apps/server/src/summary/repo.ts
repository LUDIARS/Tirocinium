import { sql } from '../db/index.js';

export type InterviewSummary = {
  id: string;
  session_id: string;
  generated_at: Date;
  headline: string;
  highlights: { turn_no: number; comment: string }[];
  axes_summary: Record<string, unknown>;
  growth_points: string[];
  carry_over: string[];
  interviewer_note: string | null;
  model: string;
};

export type SummaryInput = Omit<InterviewSummary, 'id' | 'generated_at'>;

export async function upsertSummary(s: SummaryInput): Promise<InterviewSummary> {
  const rows = await sql<InterviewSummary[]>`
    INSERT INTO interview_summaries
      (session_id, headline, highlights, axes_summary, growth_points, carry_over,
       interviewer_note, model)
    VALUES (
      ${s.session_id}, ${s.headline},
      ${sql.json(s.highlights as never)}, ${sql.json(s.axes_summary as never)},
      ${sql.json(s.growth_points as never)}, ${sql.json(s.carry_over as never)},
      ${s.interviewer_note}, ${s.model}
    )
    ON CONFLICT (session_id) DO UPDATE SET
      headline = EXCLUDED.headline,
      highlights = EXCLUDED.highlights,
      axes_summary = EXCLUDED.axes_summary,
      growth_points = EXCLUDED.growth_points,
      carry_over = EXCLUDED.carry_over,
      interviewer_note = EXCLUDED.interviewer_note,
      model = EXCLUDED.model,
      generated_at = now()
    RETURNING *
  `;
  return rows[0]!;
}

export async function getSummary(sessionId: string): Promise<InterviewSummary | null> {
  const rows = await sql<InterviewSummary[]>`
    SELECT * FROM interview_summaries WHERE session_id = ${sessionId}
  `;
  return rows[0] ?? null;
}
