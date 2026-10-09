// Cernere の project WS クライアント (埋め込みログインの代理専用)。
// project credential (Excubitor が起動ごとに注入) で project token を取り、/ws/project に接続して
// module_request を送る。ブラウザから Cernere を直接叩かせない (CORS 回避、Actio と同じ形)。
// 接続は 1 本を使い回し、切れたら次の要求で張り直す。

import { WebSocket } from 'ws';
import { config } from '../config.js';

const REQUEST_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class CernereNotConfiguredError extends Error {}

function settings() {
  const { url, projectClientId, projectClientSecret } = config.cernere;
  if (!url || !projectClientId || !projectClientSecret) {
    throw new CernereNotConfiguredError('Cernere project credentials are not configured (CERNERE_URL / CERNERE_PROJECT_CLIENT_ID / CERNERE_PROJECT_CLIENT_SECRET)');
  }
  return { url, projectClientId, projectClientSecret };
}

class CernereProjectClient {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private readonly pending = new Map<string, Pending>();

  private async projectToken(): Promise<string> {
    const s = settings();
    const res = await fetch(`${s.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'project_credentials', client_id: s.projectClientId, client_secret: s.projectClientSecret }),
    });
    if (!res.ok) throw new Error(`Cernere project login failed: ${res.status}`);
    const data = (await res.json()) as { accessToken?: string };
    if (!data.accessToken) throw new Error('Cernere project login returned no token');
    return data.accessToken;
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const wsUrl = `${settings().url.replace(/^http/, 'ws')}/ws/project`;
      const token = await this.projectToken();
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error('Cernere project WS connect timeout'));
        }, CONNECT_TIMEOUT_MS);
        ws.on('open', () => {
          clearTimeout(timer);
          this.ws = ws;
          resolve();
        });
        ws.on('message', (raw) => this.onMessage(raw.toString()));
        ws.on('ping', () => ws.pong());
        ws.on('error', (err) => console.warn('[cernere-project] ws error', err.message));
        ws.on('close', (code) => {
          clearTimeout(timer);
          if (this.ws === ws) this.ws = null;
          for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error('Cernere project WS closed'));
          }
          this.pending.clear();
          reject(new Error(`Cernere project WS closed: ${code}`));
        });
      });
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private onMessage(raw: string): void {
    let msg: { type?: string; request_id?: string; payload?: unknown; code?: string; message?: string };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (!msg.request_id) return;
    const p = this.pending.get(msg.request_id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(msg.request_id);
    if (msg.type === 'module_response') p.resolve(msg.payload);
    else p.reject(new Error(msg.message ?? `Cernere error: ${msg.code ?? 'unknown'}`));
  }

  async request(module: string, action: string, payload: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Cernere project WS is not connected');
    const requestId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Cernere request timeout: ${module}.${action}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: 'module_request', request_id: requestId, module, action, payload }));
    });
  }
}

/** 埋め込みログイン (composite) の応答。authCode か MFA の続き。 */
export type CompositeAuthResponse = { authCode?: string; mfaRequired?: boolean; mfaMethods?: string[]; mfaToken?: string };

export type CompositeAuthProxy = {
  login(email: string, password: string): Promise<CompositeAuthResponse>;
  register(name: string, email: string, password: string): Promise<CompositeAuthResponse>;
  mfaVerify(mfaToken: string, method: string, code: string): Promise<CompositeAuthResponse>;
};

const client = new CernereProjectClient();

export const cernereCompositeProxy: CompositeAuthProxy = {
  login: (email, password) => client.request('auth', 'login', { email, password }) as Promise<CompositeAuthResponse>,
  register: (name, email, password) => client.request('auth', 'register', { name, email, password }) as Promise<CompositeAuthResponse>,
  mfaVerify: (mfaToken, method, code) => client.request('auth', 'mfa-verify', { mfaToken, method, code }) as Promise<CompositeAuthResponse>,
};
