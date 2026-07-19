import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { tryStart } from '../reservation/coordinator.js';
import { sql } from '../db/index.js';
import { patchSessionMetadata } from '../db/session-metadata.js';
import { config } from '../config.js';
import { rateLimit } from '../middleware/rate-limit.js';

export const sessions = new Hono();

sessions.use('*', cernereAuth);

// セッション作成は per-user レート制限を掛ける (cernereAuth が先に user を set 済)。
const sessionCreateLimiter = rateLimit({
  windowMs: config.sessionRateLimit.windowMs,
  max: config.sessionRateLimit.max,
  keyFn: (c) => c.get('user').id,
});

/** POST /api/v1/sessions — 即時開始 or 予約 offer */
sessions.post('/', sessionCreateLimiter, async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as {
    interviewer_id?: string;
    target_company?: string;
    target_role?: string;
  };

  // users 行を遅延作成 (Cernere user_id mirror)
  await sql`
    INSERT INTO users (id) VALUES (${user.id})
    ON CONFLICT (id) DO NOTHING
  `;

  const decision = await tryStart(user.id);
  if (decision.kind === 'start') {
    // 選択された面接官 / 志望情報を session に反映 (session-runtime が persona を読む)。
    // metadata は JSON.parse/stringify を介して安全にマージする — `metadata || sql.json(...)`
    // は PG の jsonb 連結演算子であり、SQLite (metadata が TEXT 列) では文字列連結になって
    // 不正 JSON ("{...}{...}") を生み、次回 init 時の JSON.parse でクラッシュしうるため。
    if (body.interviewer_id || body.target_company || body.target_role) {
      if (body.interviewer_id) {
        await patchSessionMetadata(decision.sessionId, { interviewer_id: body.interviewer_id });
      }
      await sql`
        UPDATE sessions SET
          target_company = COALESCE(${body.target_company ?? null}, target_company),
          target_role = COALESCE(${body.target_role ?? null}, target_role)
        WHERE id = ${decision.sessionId}
      `;
    }
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
