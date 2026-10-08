import { createHash, randomBytes } from 'node:crypto';
import { sql } from '../db/index.js';

export type ReviewRole = 'student' | 'ob';
type Route = { request_id: string; role: ReviewRole; alias: string; channel_id: string | null };
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export async function participantRole(id: string, userId: string): Promise<ReviewRole | null> {
  const rows = await sql<{ student_cernere_user_id: string; matched_ob_cernere_user_id: string | null }[]>`
    SELECT student_cernere_user_id, matched_ob_cernere_user_id FROM ob_es_requests
    WHERE id = ${id} AND status = 'matched'
  `;
  const row = rows[0];
  if (row?.student_cernere_user_id === userId) return 'student';
  return row?.matched_ob_cernere_user_id === userId ? 'ob' : null;
}

export async function issuePairing(id: string, role: ReviewRole): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const alias = randomBytes(8).toString('hex');
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  await sql`
    INSERT INTO es_discord_routes (request_id, role, alias, token_hash, expires_at, channel_id)
    VALUES (${id}, ${role}, ${alias}, ${digest(token)}, ${expires}, NULL)
    ON CONFLICT (request_id, role) DO UPDATE SET alias = ${alias},
      token_hash = ${digest(token)}, expires_at = ${expires}, channel_id = NULL
  `;
  return token;
}

export async function consumePairing(token: string, channelId: string): Promise<Route | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await sql<Route[]>`
    UPDATE es_discord_routes SET channel_id = ${channelId}, token_hash = NULL
    WHERE token_hash = ${digest(token)} AND expires_at > ${new Date().toISOString()}
      AND EXISTS (SELECT 1 FROM ob_es_requests r
        WHERE r.id = es_discord_routes.request_id AND r.status = 'matched')
      AND NOT EXISTS (SELECT 1 FROM es_discord_routes other
        WHERE other.request_id = es_discord_routes.request_id
          AND other.role <> es_discord_routes.role AND other.channel_id = ${channelId})
    RETURNING request_id, role, alias, channel_id
  `;
  return rows[0] ?? null;
}

export async function relayDestination(alias: string, channelId: string): Promise<{
  requestId: string; role: ReviewRole; channelId: string; alias: string;
} | null> {
  const rows = await sql<{ request_id: string; role: ReviewRole; channel_id: string; alias: string }[]>`
    SELECT sender.request_id, sender.role, recipient.channel_id, recipient.alias
    FROM es_discord_routes sender
    JOIN es_discord_routes recipient ON recipient.request_id = sender.request_id AND recipient.role <> sender.role
    JOIN ob_es_requests r ON r.id = sender.request_id
    WHERE sender.alias = ${alias} AND sender.channel_id = ${channelId}
      AND recipient.channel_id IS NOT NULL AND r.status = 'matched'
  `;
  const row = rows[0];
  return row ? { requestId: row.request_id, role: row.role, channelId: row.channel_id, alias: row.alias } : null;
}

export async function claimDelivery(messageId: string, requestId: string): Promise<boolean> {
  const rows = await sql<{ message_id: string }[]>`
    INSERT INTO es_discord_deliveries (message_id, request_id, state, created_at)
    VALUES (${messageId}, ${requestId}, 'sending', ${new Date().toISOString()})
    ON CONFLICT (message_id) DO NOTHING RETURNING message_id
  `;
  return rows.length === 1;
}

export async function finishDelivery(messageId: string, state: 'sent' | 'unknown'): Promise<void> {
  await sql`UPDATE es_discord_deliveries SET state = ${state} WHERE message_id = ${messageId}`;
}
