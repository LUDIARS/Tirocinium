import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from '../config.js';
import { attachCernereCompositeWsRelay, relayTicket, upstreamUrl } from './cernere-composite-ws-relay.js';

const TICKET = '3f2b8c1e-0d4a-4b7e-9c55-1a2b3c4d5e6f';

describe('relayTicket', () => {
  it('他のパスは対象外 (null)', () => {
    expect(relayTicket('/api/v1/ws/session/x')).toBeNull();
  });
  it('ticket を取り出す', () => {
    expect(relayTicket(`/api/auth/cernere/ws?ticket=${TICKET}`)).toBe(TICKET);
  });
  it('ticket が無い・形が違うものは invalid', () => {
    expect(relayTicket('/api/auth/cernere/ws')).toBe('invalid');
    expect(relayTicket('/api/auth/cernere/ws?ticket=a/../b')).toBe('invalid');
  });
});

describe('upstreamUrl', () => {
  it('http(s) を ws(s) に読み替え、ticket を付ける', () => {
    expect(upstreamUrl('http://100.84.227.24:8080', TICKET)).toBe(`ws://100.84.227.24:8080/auth/composite-ws?ticket=${TICKET}`);
    expect(upstreamUrl('https://cr.example.com', TICKET)).toBe(`wss://cr.example.com/auth/composite-ws?ticket=${TICKET}`);
  });
});

describe('attachCernereCompositeWsRelay', () => {
  const servers: Server[] = [];
  const savedUrl = config.cernere.url;
  afterEach(() => {
    config.cernere.url = savedUrl;
    for (const s of servers.splice(0)) s.close();
  });

  const listen = (s: Server) =>
    new Promise<number>((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));

  it('ブラウザ ⇄ Cernere のメッセージを双方向に素通しする', async () => {
    // Cernere 役: 接続したら state を送り、届いたものを echo で返す
    const cernere = createServer();
    servers.push(cernere);
    const seenPaths: string[] = [];
    const cwss = new WebSocketServer({ server: cernere });
    cwss.on('connection', (ws, req) => {
      seenPaths.push(req.url ?? '');
      ws.send(JSON.stringify({ type: 'state', state: 'pending_device' }));
      ws.on('message', (d) => ws.send(JSON.stringify({ echo: JSON.parse(String(d)) })));
    });
    config.cernere.url = `http://127.0.0.1:${await listen(cernere)}`;

    const tr = createServer();
    servers.push(tr);
    attachCernereCompositeWsRelay(tr);
    const trPort = await listen(tr);

    const client = new WebSocket(`ws://127.0.0.1:${trPort}/api/auth/cernere/ws?ticket=${TICKET}`);
    const messages: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      client.on('message', (d) => {
        messages.push(JSON.parse(String(d)));
        if (messages.length === 1) client.send(JSON.stringify({ type: 'device', payload: {} }));
        if (messages.length === 2) resolve();
      });
      client.on('error', reject);
    });
    client.close();

    expect(seenPaths).toEqual([`/auth/composite-ws?ticket=${TICKET}`]);
    expect(messages).toEqual([{ type: 'state', state: 'pending_device' }, { echo: { type: 'device', payload: {} } }]);
  });

  it('CERNERE_URL が無ければ 503 で断る', async () => {
    config.cernere.url = '';
    const tr = createServer();
    servers.push(tr);
    attachCernereCompositeWsRelay(tr);
    const trPort = await listen(tr);
    const status = await new Promise<number | undefined>((resolve) => {
      const c = new WebSocket(`ws://127.0.0.1:${trPort}/api/auth/cernere/ws?ticket=${TICKET}`);
      c.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      c.on('error', () => resolve(undefined));
    });
    expect(status).toBe(503);
  });
});
