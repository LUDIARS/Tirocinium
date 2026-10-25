import { randomBytes } from 'node:crypto';

const TTL_MS = 30_000;
const MAX_TICKETS = 256;
type Ticket = { sessionId: string; userId: string; expiresAt: number };
const tickets = new Map<string, Ticket>();

/** Process-memory capability, issued only after Cernere ownership checks. */
export function issueCallTicket(sessionId: string, userId: string): string {
  const now = Date.now();
  for (const [key, value] of tickets) {
    if (value.expiresAt <= now || value.sessionId === sessionId) tickets.delete(key);
  }
  if (tickets.size >= MAX_TICKETS) throw new Error('call_ticket_capacity');
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, { sessionId, userId, expiresAt: now + TTL_MS });
  return ticket;
}

export function consumeCallTicket(ticket: string, sessionId: string): string | null {
  const value = tickets.get(ticket);
  tickets.delete(ticket);
  return value && value.sessionId === sessionId && value.expiresAt > Date.now()
    ? value.userId : null;
}
