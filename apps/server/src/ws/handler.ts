import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { V4 } from 'paseto';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { SessionRuntime } from './session-runtime.js';

const PATH_RE = /^\/api\/v1\/ws\/session\/([0-9a-f-]{36})(?:\?.*)?$/;

export function attachSessionWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url ?? '';
    const match = url.match(PATH_RE);
    if (!match) return; // not our path

    const sessionId = match[1]!;
    void authenticate(req).then(async (auth) => {
      if (!auth) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const ownsOk = await assertOwnership(sessionId, auth.userId);
      if (!ownsOk) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => bindWs(ws, sessionId, auth.userId));
    }).catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  });
}

async function authenticate(req: IncomingMessage): Promise<{ userId: string } | null> {
  // dev プロファイル: token 検証を飛ばして固定 dev ユーザを返す (cernereAuth と対)。
  if (config.devAuth) return { userId: config.devUserId };

  // Bearer header or ?token=... を許容 (WS では Authorization が乗らない場合あり)
  const auth = req.headers['authorization'];
  let token: string | null = null;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    token = auth.slice(7);
  } else {
    const url = req.url ?? '';
    const m = url.match(/[?&]token=([^&]+)/);
    if (m) token = decodeURIComponent(m[1]!);
  }
  if (!token || !config.cernerePublicKey) return null;
  try {
    const payload = (await V4.verify(token, config.cernerePublicKey, {
      audience: config.cernereAudience,
    })) as { sub?: string; exp?: string };
    if (payload.exp && Date.parse(payload.exp) < Date.now()) return null;
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

async function assertOwnership(sessionId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ user_id: string; status: string }[]>`
    SELECT user_id, status FROM sessions WHERE id = ${sessionId}
  `;
  if (rows.length === 0) return false;
  if (rows[0]!.user_id !== userId) return false;
  if (rows[0]!.status !== 'active') return false;
  return true;
}

function bindWs(ws: WebSocket, sessionId: string, userId: string): void {
  const runtime = new SessionRuntime(ws, sessionId, userId);
  void runtime.init();

  ws.on('message', (data) => {
    void runtime.onMessage(data.toString('utf8'));
  });
  ws.on('close', () => {
    void runtime.close();
  });
  ws.on('error', () => {
    void runtime.close();
  });
}
