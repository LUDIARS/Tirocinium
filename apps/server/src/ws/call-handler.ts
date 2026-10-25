import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { sql } from '../db/index.js';
import { SessionRuntime } from './session-runtime.js';
import { consumeCallTicket } from './call-tickets.js';
import { isClientFrame } from './frames.js';

/** The first frame authenticates; credentials never appear in the request URL. */
export function attachCallWs(server: Server, reportFailure: (code: string) => void): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  const owners = new Map<string, object>();
  server.on('upgrade', (req, socket, head) => {
    const match = (req.url ?? '').match(/^\/api\/v1\/ws\/call\/([0-9a-f-]{36})$/);
    if (!match) return;
    const sessionId = match[1]!;
    wss.handleUpgrade(req, socket, head, (ws) => {
      let runtime: SessionRuntime | null = null;
      let userId: string | null = null;
      let disposed = false;
      let started = false;
      const owner = {};
      let pending = 0;
      let queue = Promise.resolve();
      let timer = setTimeout(() => ws.close(1008, 'authentication_timeout'), 5_000);
      const dispose = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        try {
          await runtime?.close();
        } finally {
          if (owners.get(sessionId) === owner) {
            try {
              await sql`UPDATE sessions SET status = 'ended', ended_at = now()
                WHERE id = ${sessionId} AND user_id = ${userId} AND status = 'active'`;
            } finally {
              owners.delete(sessionId);
            }
          }
        }
      };
      ws.on('message', (raw, binary) => {
        if (disposed) return;
        if (++pending > 16) {
          ws.close(1008, 'call_backpressure');
          void dispose().catch(() => reportFailure('cleanup_failed'));
          return;
        }
        queue = queue.then(async () => {
          if (disposed) return;
          if (binary) throw new Error('text_frames_required');
          const frame: unknown = JSON.parse(raw.toString('utf8'));
          if (!runtime) {
            const ticket = frame && typeof frame === 'object'
              ? (frame as { ticket?: unknown }).ticket : null;
            if (typeof ticket !== 'string') throw new Error('unauthorized');
            userId = consumeCallTicket(ticket, sessionId);
            if (!userId) throw new Error('unauthorized');
            if (owners.has(sessionId)) throw new Error('call_already_connected');
            owners.set(sessionId, owner);
            clearTimeout(timer);
            timer = setTimeout(() => ws.close(1011, 'initialization_timeout'), 30_000);
            const rows = await sql<{ id: string }[]>`SELECT id FROM sessions
              WHERE id = ${sessionId} AND user_id = ${userId} AND status = 'active'`;
            if (!rows.length || disposed) throw new Error('inactive_session');
            runtime = new SessionRuntime(ws, sessionId, userId);
            await runtime.init();
            if (disposed) await runtime.close();
            else clearTimeout(timer);
            return;
          }
          if (!isClientFrame(frame)) throw new Error('invalid_frame');
          if (frame.kind === 'start_interview') {
            if (started) throw new Error('interview_already_started');
            started = true;
            // LLM generation must not block audio ingestion or barge-in in this
            // transport queue. Runtime owns and aborts its generation resources.
            void runtime.onMessage(JSON.stringify(frame)).catch(async () => {
              ws.close(1011, 'interview_failed');
              await dispose();
            }).catch(() => reportFailure('cleanup_failed'));
            return;
          }
          await runtime.onMessage(JSON.stringify(frame));
        }).catch(async () => {
          // Frame contents may contain speech or credentials; never log them.
          ws.close(1008, 'call_failed');
          await dispose();
        }).catch(() => reportFailure('cleanup_failed')).finally(() => { pending--; });
      });
      ws.on('close', () => { void dispose().catch(() => reportFailure('cleanup_failed')); });
      ws.on('error', () => { void dispose().catch(() => reportFailure('cleanup_failed')); });
    });
  });
  server.on('close', () => {
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  });
}
