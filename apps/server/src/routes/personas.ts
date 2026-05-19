import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import {
  createExaminee,
  createInterviewer,
  getExaminee,
  getInterviewer,
  listExaminees,
  listInterviewers,
} from '../persona/repo.js';

export const personas = new Hono();
personas.use('*', cernereAuth);

// === Interviewers ===

personas.get('/interviewers', async (c) => {
  const stage = c.req.query('stage');
  const role = c.req.query('role_lens');
  const temperament = c.req.query('temperament');
  const rows = await listInterviewers({
    stage: stage ?? undefined,
    role_lens: role ?? undefined,
    temperament: temperament ?? undefined,
  });
  return c.json({ personas: rows });
});

personas.get('/interviewers/:id', async (c) => {
  const p = await getInterviewer(c.req.param('id'));
  if (!p) return c.json({ error: 'not_found' }, 404);
  return c.json({ persona: p });
});

personas.post('/interviewers', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        id: string;
        display_name: string;
        stage: 'hr' | 'peer-tech' | 'lead-tech' | 'final';
        role_lens?: string;
        temperament: string;
        pressure: number;
        tics?: string[];
        bio: string;
        evaluation_bias?: Record<string, number>;
      }
    | null;
  if (!body?.id || !body.display_name || !body.stage || !body.temperament) {
    return c.json({ error: 'missing_required_fields' }, 400);
  }
  try {
    const created = await createInterviewer({
      id: body.id,
      display_name: body.display_name,
      stage: body.stage,
      role_lens: body.role_lens ?? 'any',
      temperament: body.temperament,
      pressure: body.pressure,
      tics: body.tics ?? [],
      bio: body.bio,
      evaluation_bias: body.evaluation_bias ?? {},
    });
    return c.json({ persona: created }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (/duplicate key/.test(msg)) return c.json({ error: 'id_exists' }, 409);
    return c.json({ error: 'create_failed', detail: msg }, 500);
  }
});

// === Examinees ===

personas.get('/examinees', async (c) => {
  const role = c.req.query('target_role');
  const rows = await listExaminees(role ?? undefined);
  return c.json({ personas: rows });
});

personas.get('/examinees/:id', async (c) => {
  const p = await getExaminee(c.req.param('id'));
  if (!p) return c.json({ error: 'not_found' }, 404);
  return c.json({ persona: p });
});

personas.post('/examinees', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        id: string;
        display_name: string;
        background: string;
        target_role: string;
        weakness_axes?: Record<string, number>;
        strengths?: string[];
        speech_style: string;
        intentional_flaws?: string[];
        bio: string;
      }
    | null;
  if (!body?.id || !body.display_name || !body.background || !body.target_role || !body.speech_style) {
    return c.json({ error: 'missing_required_fields' }, 400);
  }
  try {
    const created = await createExaminee({
      id: body.id,
      display_name: body.display_name,
      background: body.background,
      target_role: body.target_role,
      weakness_axes: body.weakness_axes ?? {},
      strengths: body.strengths ?? [],
      speech_style: body.speech_style,
      intentional_flaws: body.intentional_flaws ?? [],
      bio: body.bio,
    });
    return c.json({ persona: created }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (/duplicate key/.test(msg)) return c.json({ error: 'id_exists' }, 409);
    return c.json({ error: 'create_failed', detail: msg }, 500);
  }
});
