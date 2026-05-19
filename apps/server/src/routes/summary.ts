import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { getSummary } from '../summary/repo.js';
import { sql } from '../db/index.js';

export const summary = new Hono();
summary.use('*', cernereAuth);

// GET /api/v1/sessions/:id/summary
summary.get('/:id/summary', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  // session の所有者チェック
  const sessions = await sql<{ user_id: string }[]>`
    SELECT user_id FROM sessions WHERE id = ${sessionId}
  `;
  if (sessions.length === 0) return c.json({ error: 'session_not_found' }, 404);
  if (sessions[0]!.user_id !== user.id) return c.json({ error: 'forbidden' }, 403);

  const s = await getSummary(sessionId);
  if (!s) return c.json({ error: 'summary_not_yet_generated' }, 404);
  return c.json({ summary: s });
});

// POST /api/v1/sessions/:id/summary (生成 trigger、 LLM 未実装なので 501)
summary.post('/:id/summary', async (c) => {
  return c.json(
    { error: 'not_implemented', detail: 'LLM Orchestrator (PR-iii) で実装' },
    501,
  );
});
