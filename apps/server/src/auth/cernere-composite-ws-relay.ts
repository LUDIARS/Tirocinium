// Cernere composite 認証の本人確認 WS をブラウザ ⇄ Cernere で中継する。
// パスワードが通ると Cernere は {ticket, wsPath} を返し、端末 fingerprint → 確認コード → authCode を
// `${CERNERE_URL}/auth/composite-ws?ticket=` の WS で進める。ブラウザは Cernere の内部 URL に届かないので、
// Tirocinium の `/api/auth/cernere/ws?ticket=` で受けて素通しする。中身は読まず保存もしない
// (ticket と確認コードを含むのでログにも出さない)。ticket の検証は Cernere が行う。

import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { config } from '../config.js';

const RELAY_PATH = '/api/auth/cernere/ws';
// Cernere の ticket は英数字と - _ のみ。それ以外は中継しない (URL への混入を防ぐ)
const TICKET_RE = /^[A-Za-z0-9_-]{16,256}$/;

/** `/api/auth/cernere/ws?ticket=...` なら ticket を返す。他のパスは null (このハンドラの対象外)。 */
export function relayTicket(reqUrl: string): string | null | 'invalid' {
  const url = new URL(reqUrl, 'http://relay.invalid');
  if (url.pathname !== RELAY_PATH) return null;
  const ticket = url.searchParams.get('ticket') ?? '';
  return TICKET_RE.test(ticket) ? ticket : 'invalid';
}

/** Cernere 側の WS URL。CERNERE_URL が http(s) なら ws(s) に読み替える。 */
export function upstreamUrl(cernereUrl: string, ticket: string): string {
  const url = new URL('/auth/composite-ws', cernereUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

function reject(socket: Socket, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
}

export function attachCernereCompositeWsRelay(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const ticket = relayTicket(req.url ?? '');
    if (ticket === null) return; // not our path
    if (ticket === 'invalid') return reject(socket, '400 Bad Request');
    if (!config.cernere.url) return reject(socket, '503 Service Unavailable');

    // 先に Cernere へつなぎ、つながってからブラウザ側を upgrade する (失敗をブラウザへ HTTP で返せる)
    const upstream = new WebSocket(upstreamUrl(config.cernere.url, ticket));
    const pending: RawData[] = [];
    let client: WebSocket | null = null;

    upstream.on('message', (data, isBinary) => {
      if (client && client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      else pending.push(data);
    });
    upstream.once('open', () => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        client = ws;
        for (const data of pending.splice(0)) ws.send(data, { binary: false });
        ws.on('message', (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        });
        ws.on('close', () => upstream.close());
        ws.on('error', () => upstream.close());
      });
    });
    upstream.on('close', (code) => {
      if (client) client.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011);
      else if (!socket.destroyed) reject(socket, '502 Bad Gateway');
    });
    upstream.on('error', (err) => {
      console.warn(`[auth] Cernere composite WS relay failed: ${err.message}`);
      if (!client && !socket.destroyed) reject(socket, '502 Bad Gateway');
    });
    socket.on('error', () => upstream.terminate());
  });
}
