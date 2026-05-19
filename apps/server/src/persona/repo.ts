import { sql } from '../db/index.js';

export type InterviewerPersona = {
  id: string;
  display_name: string;
  stage: 'hr' | 'peer-tech' | 'lead-tech' | 'final';
  role_lens: string;
  temperament: string;
  pressure: number;
  tics: string[];
  bio: string;
  evaluation_bias: Record<string, number>;
  is_seed: boolean;
  created_at: Date;
};

export type ExamineePersona = {
  id: string;
  display_name: string;
  background: string;
  target_role: string;
  weakness_axes: Record<string, number>;
  strengths: string[];
  speech_style: string;
  intentional_flaws: string[];
  bio: string;
  is_seed: boolean;
  created_at: Date;
};

export type InterviewerFilter = {
  stage?: string;
  role_lens?: string;
  temperament?: string;
};

export async function listInterviewers(f: InterviewerFilter = {}): Promise<InterviewerPersona[]> {
  // 単純化のため動的 WHERE は配列で組み立て
  const conds: string[] = [];
  const vals: unknown[] = [];
  if (f.stage) { vals.push(f.stage); conds.push(`stage = $${vals.length}`); }
  if (f.role_lens) { vals.push(f.role_lens); conds.push(`role_lens = $${vals.length}`); }
  if (f.temperament) { vals.push(f.temperament); conds.push(`temperament = $${vals.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return sql.unsafe<InterviewerPersona[]>(
    `SELECT * FROM interviewer_personas ${where} ORDER BY stage, pressure, id`,
    vals as never[],
  );
}

export async function getInterviewer(id: string): Promise<InterviewerPersona | null> {
  const rows = await sql<InterviewerPersona[]>`
    SELECT * FROM interviewer_personas WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function createInterviewer(p: Omit<InterviewerPersona, 'is_seed' | 'created_at'>): Promise<InterviewerPersona> {
  const rows = await sql<InterviewerPersona[]>`
    INSERT INTO interviewer_personas
      (id, display_name, stage, role_lens, temperament, pressure, tics, bio, evaluation_bias, is_seed)
    VALUES (
      ${p.id}, ${p.display_name}, ${p.stage}, ${p.role_lens}, ${p.temperament},
      ${p.pressure}, ${p.tics}, ${p.bio}, ${sql.json(p.evaluation_bias as never)}, false
    )
    RETURNING *
  `;
  return rows[0]!;
}

export async function listExaminees(targetRole?: string): Promise<ExamineePersona[]> {
  if (targetRole) {
    return sql<ExamineePersona[]>`
      SELECT * FROM examinee_personas WHERE target_role = ${targetRole}
      ORDER BY id
    `;
  }
  return sql<ExamineePersona[]>`SELECT * FROM examinee_personas ORDER BY id`;
}

export async function getExaminee(id: string): Promise<ExamineePersona | null> {
  const rows = await sql<ExamineePersona[]>`
    SELECT * FROM examinee_personas WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function createExaminee(p: Omit<ExamineePersona, 'is_seed' | 'created_at'>): Promise<ExamineePersona> {
  const rows = await sql<ExamineePersona[]>`
    INSERT INTO examinee_personas
      (id, display_name, background, target_role, weakness_axes, strengths,
       speech_style, intentional_flaws, bio, is_seed)
    VALUES (
      ${p.id}, ${p.display_name}, ${p.background}, ${p.target_role},
      ${sql.json(p.weakness_axes as never)}, ${p.strengths},
      ${p.speech_style}, ${p.intentional_flaws}, ${p.bio}, false
    )
    RETURNING *
  `;
  return rows[0]!;
}
