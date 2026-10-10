// Cernere composite 認証の本人確認 WS セッション。
// パスワードが通ると Cernere は authCode ではなく {ticket, wsPath} を返し、続き (端末の fingerprint 送信 →
// 必要なら確認コード → authCode) は WS で進む (Cernere server/src/ws/composite-auth.ts)。
// ブラウザは Cernere へ直接つながず、Tirocinium サーバの /api/auth/cernere/ws に張る (サーバが中継する)。
// 状態機械は Cernere frontend/src/lib/composite-ws-session.ts と同じ。open / verifyCode / resend は次の決着を待つ。

import { collectDeviceFingerprint, type DeviceFingerprint } from '@ludiars/cernere-composite/ui';
import { SERVER_URL } from '../config.js';

export type CompositeChallengeInfo = {
  deviceToken?: string;
  emailMasked?: string;
  anomalies?: Array<'new_device' | 'new_os' | 'new_browser' | 'new_ip' | 'missing_fingerprint'>;
  codeChannel?: 'email' | 'console';
  deviceLabel?: string;
  error?: string;
  remainingAttempts?: number;
  resent?: boolean;
};

export type CompositeWsOutcome =
  | { kind: 'challenge'; data: CompositeChallengeInfo }
  | { kind: 'authenticated'; authCode: string };

type ServerMessage =
  | { type: 'state'; state: 'pending_device' | 'challenge_pending' | 'authenticated' | 'expired'; data?: CompositeChallengeInfo }
  | { type: 'authenticated'; authCode: string }
  | { type: 'error'; retryable: boolean; reason: string }
  | { type: 'ping'; ts: number };

type Waiter = { resolve: (o: CompositeWsOutcome) => void; reject: (e: Error) => void };

const FINGERPRINT_RETRY_DELAY_MS = 500;
const MAX_FINGERPRINT_RETRIES = 3;

/** Cernere の wsPath (`/auth/composite-ws?ticket=...`) から ticket を取り出す。 */
export function ticketFromWsPath(wsPath: string): string {
  const ticket = new URL(wsPath, 'http://cernere.invalid').searchParams.get('ticket');
  if (!ticket) throw new Error('Cernere の応答に ticket がありません');
  return ticket;
}

/** Tirocinium サーバの中継口。SERVER_URL が空なら同一オリジン (Vite proxy / CF 経由)。 */
export function relayWsUrl(ticket: string, base: string = SERVER_URL, loc: Location = window.location): string {
  const origin = base || `${loc.protocol}//${loc.host}`;
  const url = new URL('/api/auth/cernere/ws', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

export class CompositeWsSession {
  private ws: WebSocket | null = null;
  private waiter: Waiter | null = null;
  private fingerprintSent = false;
  private fingerprintRetryCount = 0;
  private fingerprintRetryTimer: number | null = null;

  constructor(private readonly fingerprint: DeviceFingerprint | undefined) {}

  /** 接続し、最初の決着 (確認コード要求 or 認証完了) を待つ。 */
  open(wsPath: string): Promise<CompositeWsOutcome> {
    if (this.ws) throw new Error('composite WS session is already open');
    const url = relayWsUrl(ticketFromWsPath(wsPath));
    return new Promise<CompositeWsOutcome>((resolve, reject) => {
      this.waiter = { resolve, reject };
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data as string) as ServerMessage;
        } catch {
          return;
        }
        this.handleMessage(ws, msg);
      };
      ws.onerror = () => this.fail(new Error('本人確認の接続でエラーが発生しました'));
      ws.onclose = () => {
        this.ws = null;
        this.clearFingerprintRetry();
        this.fail(new Error('本人確認の接続が切れました。最初からやり直してください'));
      };
    });
  }

  verifyCode(code: string): Promise<CompositeWsOutcome> {
    return this.request({ type: 'verify_code', code });
  }

  async resend(): Promise<void> {
    await this.request({ type: 'resend' });
  }

  /** WS を閉じる。待機中の Promise は reject する (所有者の unmount 時に必ず呼ぶ)。 */
  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.clearFingerprintRetry();
    if (ws) {
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
    this.fail(new Error('本人確認の接続を閉じました'));
  }

  private request(payload: { type: 'verify_code'; code: string } | { type: 'resend' }): Promise<CompositeWsOutcome> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('本人確認の接続が切れました。最初からやり直してください'));
    }
    if (this.waiter) return Promise.reject(new Error('前の操作の応答を待っています'));
    return new Promise<CompositeWsOutcome>((resolve, reject) => {
      this.waiter = { resolve, reject };
      ws.send(JSON.stringify(payload));
    });
  }

  private settle(outcome: CompositeWsOutcome): void {
    const w = this.waiter;
    this.waiter = null;
    w?.resolve(outcome);
  }

  private fail(err: Error): void {
    const w = this.waiter;
    this.waiter = null;
    w?.reject(err);
  }

  private sendFingerprint(ws: WebSocket): void {
    let payload: DeviceFingerprint | Record<string, never>;
    try {
      payload = this.fingerprint ?? collectDeviceFingerprint();
    } catch {
      // 収集できない環境は空で送り、サーバに missing_fingerprint として判定させる (黙って止めない)
      payload = {};
    }
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'device', payload }));
    this.fingerprintSent = true;
  }

  private scheduleFingerprintRetry(ws: WebSocket): void {
    if (this.fingerprintRetryTimer !== null) return;
    if (this.fingerprintRetryCount >= MAX_FINGERPRINT_RETRIES) {
      this.fail(new Error('端末情報を取得できませんでした。最初からやり直してください'));
      this.close();
      return;
    }
    this.fingerprintRetryCount += 1;
    this.fingerprintRetryTimer = window.setTimeout(() => {
      this.fingerprintRetryTimer = null;
      if (ws === this.ws && ws.readyState === WebSocket.OPEN) this.sendFingerprint(ws);
    }, FINGERPRINT_RETRY_DELAY_MS);
  }

  private clearFingerprintRetry(): void {
    if (this.fingerprintRetryTimer === null) return;
    window.clearTimeout(this.fingerprintRetryTimer);
    this.fingerprintRetryTimer = null;
  }

  private handleMessage(ws: WebSocket, msg: ServerMessage): void {
    switch (msg.type) {
      case 'state':
        if (msg.state === 'pending_device') {
          if (!this.fingerprintSent) this.sendFingerprint(ws);
        } else if (msg.state === 'challenge_pending') {
          this.clearFingerprintRetry();
          this.fingerprintRetryCount = 0;
          this.settle({ kind: 'challenge', data: msg.data ?? {} });
        } else if (msg.state === 'expired') {
          this.fail(new Error('本人確認の期限が切れました。最初からやり直してください'));
          this.close();
        }
        return;
      case 'authenticated':
        this.settle({ kind: 'authenticated', authCode: msg.authCode });
        return;
      case 'error':
        if (msg.retryable && msg.reason.includes('fingerprint')) {
          this.fingerprintSent = false;
          this.scheduleFingerprintRetry(ws);
          return;
        }
        this.fail(new Error(msg.reason));
        if (!msg.retryable) this.close();
        return;
      case 'ping':
        try {
          ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
        } catch {
          /* socket closing */
        }
        return;
    }
  }
}
