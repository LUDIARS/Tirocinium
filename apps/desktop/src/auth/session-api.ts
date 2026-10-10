// Tirocinium サーバの /api/auth (Cernere 埋め込みログインの入口) を呼ぶ。
// <CompositeLogin> の authApi と、authCode の交換・token の取り直しを持つ。
import type { CompositeAuthApi, CompositeAuthResponse, DeviceFingerprint } from '@ludiars/cernere-composite/ui';
import { SERVER_URL } from '../config.js';
import { CompositeWsSession, type CompositeWsOutcome } from './composite-ws-session.js';

export type TrSession = {
  token: string;
  expiresIn: number;
  refreshToken: string;
  user: { id: string; displayName: string };
};

/** Cernere の login / register / mfa-verify の応答 (Tirocinium サーバがそのまま返す)。 */
type CernereLoginResponse = CompositeAuthResponse & { ticket?: string; wsPath?: string };

/**
 * 本人確認は WS 接続に紐づき deviceToken を使わないが、SDK は deviceToken が truthy のときだけ
 * 確認コード画面へ進むので、接続識別のプレースホルダを入れる (Cernere 自身のフロントと同じ)。
 */
const WS_BOUND_DEVICE_TOKEN = 'composite-ws';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `ログインに失敗しました (HTTP ${res.status})`);
  return data as T;
}

export function outcomeToResponse(outcome: CompositeWsOutcome): CompositeAuthResponse {
  if (outcome.kind === 'authenticated') return { authCode: outcome.authCode };
  const d = outcome.data;
  return {
    deviceVerificationRequired: true,
    deviceToken: d.deviceToken ?? WS_BOUND_DEVICE_TOKEN,
    emailMasked: d.emailMasked,
    anomalies: d.anomalies,
    codeChannel: d.codeChannel,
    deviceLabel: d.deviceLabel,
    error: d.error,
    remainingAttempts: d.remainingAttempts,
  };
}

/**
 * ブラウザから Cernere を直接呼ばず、Tirocinium サーバ経由で代理する (CORS 回避、Actio と同じ形)。
 * パスワードが通った後の本人確認 (ticket + wsPath) は CompositeWsSession で進め、authCode まで持っていく。
 * 応答に authCode も MFA も本人確認も無ければエラーにする (SDK は黙って何もしないため)。
 */
export class TrCompositeAuthApi implements CompositeAuthApi {
  private session: CompositeWsSession | null = null;

  async login(params: { email: string; password: string; device?: DeviceFingerprint }): Promise<CompositeAuthResponse> {
    const data = await post<CernereLoginResponse>('/cernere/login', { email: params.email, password: params.password });
    return this.continueFlow(data, params.device);
  }

  async register(params: { name: string; email?: string; password?: string; device?: DeviceFingerprint }): Promise<CompositeAuthResponse> {
    if (!params.email || !params.password) throw new Error('登録にはメールアドレスとパスワードが必要です');
    const data = await post<CernereLoginResponse>('/cernere/register', { name: params.name, email: params.email, password: params.password });
    return this.continueFlow(data, params.device);
  }

  async mfaVerify(params: { mfaToken: string; method: string; code: string; device?: DeviceFingerprint }): Promise<CompositeAuthResponse> {
    const data = await post<CernereLoginResponse>('/cernere/mfa-verify', { mfaToken: params.mfaToken, method: params.method, code: params.code });
    return this.continueFlow(data, params.device);
  }

  async deviceVerify(params: { deviceToken: string; code: string }): Promise<CompositeAuthResponse> {
    const response = outcomeToResponse(await this.requireSession().verifyCode(params.code));
    if (response.authCode) this.dispose();
    return response;
  }

  async deviceResend(): Promise<CompositeAuthResponse> {
    await this.requireSession().resend();
    return {};
  }

  /** 画面の unmount 時に呼ぶ。進行中の WS を閉じる。 */
  dispose(): void {
    const s = this.session;
    this.session = null;
    s?.close();
  }

  private async continueFlow(data: CernereLoginResponse, device: DeviceFingerprint | undefined): Promise<CompositeAuthResponse> {
    if (data.mfaRequired) {
      this.dispose();
      return { mfaRequired: true, mfaToken: data.mfaToken, mfaMethods: data.mfaMethods };
    }
    if (data.authCode) return { authCode: data.authCode };
    if (!data.wsPath) throw new Error('Cernere の応答を解釈できませんでした (authCode / MFA / 本人確認のいずれもありません)');
    this.dispose(); // やり直しは前回の WS を閉じてから張り直す
    const session = new CompositeWsSession(device);
    this.session = session;
    try {
      const response = outcomeToResponse(await session.open(data.wsPath));
      if (response.authCode) this.dispose();
      return response;
    } catch (err) {
      this.dispose();
      throw err;
    }
  }

  private requireSession(): CompositeWsSession {
    if (!this.session) throw new Error('本人確認の接続が切れました。最初からやり直してください');
    return this.session;
  }
}

export const exchangeAuthCode = (authCode: string) => post<TrSession>('/exchange', { authCode });
export const refreshTrSession = (refreshToken: string) => post<TrSession>('/refresh', { refreshToken });
