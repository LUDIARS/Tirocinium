import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { tryStart } from '../reservation/coordinator.js';
import { sql } from '../db/index.js';
import { config } from '../config.js';

export const sessions = new Hono();

sessions.use('*', cernereAuth);

/** POST /api/v1/sessions — 即時開始 or 予約 offer */
sessions.post('/', async (c) => {
  const user = c.get('user');

  // users 行を遅延作成 (Cernere user_id mirror)
  await sql`
    INSERT INTO users (id) VALUES (${user.id})
    ON CONFLICT (id) DO NOTHING
  `;

  const decision = await tryStart(user.id);
  if (decision.kind === 'start') {
    const wsUrl = `/api/v1/ws/session/${decision.sessionId}`;
    return c.json({ session_id: decision.sessionId, ws_url: wsUrl });
  }
  if (decision.kind === 'offer') {
    const etaMin = Math.round((decision.slotStart.getTime() - Date.now()) / 60000);
    return c.json({
      reservation_offer: {
        slot_start: decision.slotStart.toISOString(),
        eta_min: etaMin,
        slot_duration_min: config.slotDurationMin,
      },
    });
  }
  return c.json({ error: decision.reason }, 503);
});

/** GET /api/v1/sessions/:id */
sessions.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const rows = await sql<
    { id: string; user_id: string; mode: string; status: string; started_at: Date }[]
  >`
    SELECT id, user_id, mode, status, started_at
    FROM sessions WHERE id = ${id}
  `;
  const s = rows[0];
  if (!s) return c.json({ error: 'not_found' }, 404);
  if (s.user_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  return c.json({ session: s });
});

/** POST /api/v1/sessions/:id/end */
sessions.post('/:id/end', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const result = await sql<{ id: string }[]>`
    UPDATE sessions
       SET status = 'ended', ended_at = now()
     WHERE id = ${id} AND user_id = ${user.id} AND status = 'active'
    RETURNING id
  `;
  if (result.length === 0) return c.json({ error: 'not_found_or_not_active' }, 404);
  return c.json({ ok: true });
});
