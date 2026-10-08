import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { cernereAuth } from '../auth/cernere.js';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { issuePairing, participantRole } from './routing.js';

export const reviewActions = new Hono();
reviewActions.get('/client.js', async (c) => {
  const script = await readFile(new URL('../../../../es-review-viewer/client.js', import.meta.url), 'utf8');
  return c.body(script, 200, { 'Content-Type': 'text/javascript; charset=utf-8' });
});
reviewActions.use('*', cernereAuth);
reviewActions.post('/:id/discord', async (c) => {
  if (!config.discord.botToken) return c.json({ error: 'discord_not_configured' }, 503);
  const id = c.req.param('id');
  const role = await participantRole(id, c.get('user').id);
  if (!role) return c.json({ error: 'not_found_or_closed' }, 404);
  const token = await issuePairing(id, role);
  c.header('Cache-Control', 'no-store');
  return c.json({ command: `${config.discord.commandPrefix} es connect ${token}`, expires_in_seconds: 600 });
});
reviewActions.post('/:id/close', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user').id;
  const rows = await sql<{ id: string }[]>`
    UPDATE ob_es_requests SET status = 'closed', updated_at = ${new Date().toISOString()}
    WHERE id = ${id} AND status <> 'closed'
      AND (student_cernere_user_id = ${user} OR matched_ob_cernere_user_id = ${user})
    RETURNING id
  `;
  if (!rows.length) return c.json({ error: 'not_found_or_closed' }, 404);
  await sql`DELETE FROM es_discord_routes WHERE request_id = ${id}`;
  return c.json({ ok: true });
});
