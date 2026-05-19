import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { getSummary } from '../summary/repo.js';
import { generateSummaryForSession } from '../summary/generator.js';
import { sql } from '../db/index.js';

export const summary = new Hono();
summary.use('*', cernereAuth);

async function assertOwner(sessionId: string, userId: string): Promise<'ok' | 'not_found' | 'forbidden'> {
  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM sessions WHERE id = ${sessionId}
  `;
  if (rows.length === 0) return 'not_found';
  if (rows[0]!.user_id !== userId) return 'forbidden';
  return 'ok';
}

// GET /api/v1/sessions/:id/summary
summary.get('/:id/summary', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const own = await assertOwner(sessionId, user.id);
  if (own !== 'ok') return c.json({ error: own === 'not_found' ? 'session_not_found' : 'forbidden' }, own === 'not_found' ? 404 : 403);

  const s = await getSummary(sessionId);
  if (!s) return c.json({ error: 'summary_not_yet_generated' }, 404);
  return c.json({ summary: s });
});

// POST /api/v1/sessions/:id/summary — Opus 生成 trigger
summary.post('/:id/summary', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const own = await assertOwner(sessionId, user.id);
  if (own !== 'ok') return c.json({ error: own === 'not_found' ? 'session_not_found' : 'forbidden' }, own === 'not_found' ? 404 : 403);

  try {
    const result = await generateSummaryForSession(sessionId);
    if (!result.ok) {
      if (result.reason === 'anthropic_api_key_missing') {
        return c.json({ error: 'llm_not_configured' }, 503);
      }
      if (result.reason === 'no_turns') {
        return c.json({ error: 'no_turns_to_summarize' }, 409);
      }
      return c.json({ error: 'generation_failed', detail: result.reason }, 500);
    }
    const s = await getSummary(sessionId);
    return c.json({ summary: s });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return c.json({ error: 'generation_failed', detail: msg }, 500);
  }
});
