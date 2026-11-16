// Tirocinium サーバの /api/auth (Cernere 埋め込みログインの入口) を呼ぶ。
// ログインはパスキーのみ。<CompositeLogin> の authApi が begin/finish をサーバ経由で Cernere の project WS へ中継し、
// 得た authCode を PKCE の verifier と一緒にサーバで交換して、Tirocinium 自前のセッションを受け取る。
// Cernere の user token / refresh token はブラウザにもサーバにも来ない。
import type {
  CompositeAuthApi,
  CompositeAuthResponse,
  PasskeyLoginBeginResult,
} from '@ludiars/cernere-composite/ui';
import { SERVER_URL } from '../config.js';
import type { CompositePkce } from './pkce.js';

export type TrSession = {
  sessionToken: string;
  expiresAt: number;
  user: { id: string; displayName: string };
};

async function post<T>(path: string, body: unknown, bearer?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`${SERVER_URL}/api/auth${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `ログインに失敗しました (HTTP ${res.status})`);
  return data as T;
}

/**
 * パスキーの begin/finish に、このログイン試行の code_challenge と state を付けて中継する。
 * 送り先 (client_id / 公開オリジン) はサーバが設定から足すので、画面からは送らない。
 * verifier は渡さない (交換のときだけ使う)。
 */
export class TrCompositeAuthApi implements CompositeAuthApi {
  constructor(private readonly pkce: CompositePkce) {}

  passkeyLoginBegin(): Promise<PasskeyLoginBeginResult> {
    return post<PasskeyLoginBeginResult>('/cernere/passkey-login-begin', this.binding());
  }

  passkeyLoginFinish(params: Parameters<CompositeAuthApi['passkeyLoginFinish']>[0]): Promise<CompositeAuthResponse> {
    return post<CompositeAuthResponse>('/cernere/passkey-login-finish', {
      ...this.binding(),
      challengeOwner: params.challengeOwner,
      response: params.response,
    });
  }

  private binding(): { code_challenge: string; state: string } {
    return { code_challenge: this.pkce.codeChallenge, state: this.pkce.state };
  }
}

export const exchangeAuthCode = (code: string, codeVerifier: string) =>
  post<TrSession>('/exchange', { code, code_verifier: codeVerifier });

export const logoutTrSession = (sessionToken: string) => post<{ ok: true }>('/logout', {}, sessionToken);
