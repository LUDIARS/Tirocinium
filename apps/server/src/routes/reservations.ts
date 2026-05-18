import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import {
  cancel,
  listMyReservations,
  listSlots,
  reserve,
} from '../reservation/coordinator.js';

export const reservations = new Hono();

reservations.use('*', cernereAuth);

/** GET /api/v1/reservations/slots?from=ISO&hours=24 */
reservations.get('/slots', async (c) => {
  const fromParam = c.req.query('from');
  const hoursParam = c.req.query('hours');
  const from = fromParam ? new Date(fromParam) : new Date();
  const hours = Math.min(Math.max(Number.parseInt(hoursParam ?? '24', 10) || 24, 1), 168);
  const rows = await listSlots(from, hours);
  return c.json({ slots: rows });
});

/** POST /api/v1/reservations  body: { slot_start } */
reservations.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null) as { slot_start?: string } | null;
  if (!body?.slot_start) return c.json({ error: 'slot_start required' }, 400);
  try {
    const r = await reserve(user.id, new Date(body.slot_start));
    return c.json({ id: r.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg === 'slot_full') return c.json({ error: 'slot_full' }, 409);
    return c.json({ error: 'reservation_failed', detail: msg }, 500);
  }
});

/** GET /api/v1/reservations/me */
reservations.get('/me', async (c) => {
  const user = c.get('user');
  const rows = await listMyReservations(user.id);
  return c.json({ reservations: rows });
});

/** DELETE /api/v1/reservations/:id */
reservations.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  try {
    await cancel(id, user.id);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    if (msg === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (msg === 'cannot_cancel') return c.json({ error: 'cannot_cancel' }, 409);
    return c.json({ error: 'cancel_failed', detail: msg }, 500);
  }
});
