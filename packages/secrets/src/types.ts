// Excubitor secret-agent クライアントの型。
// 各サービスは起動時に agent (Excubitor) へ自分の service code を投げ、 resolved secret を
// in-process で受け取る (env もファイルも使わない)。

export type ResolvedSecrets = Record<string, string>;

export type ResolveOptions = {
  /** agent の base URL (既定 EXCUBITOR_URL ?? http://127.0.0.1:17332) */
  baseUrl?: string;
  /** agent token (既定 EXCUBITOR_AGENT_TOKEN env or token ファイル) */
  token?: string;
  /** 返すキーを絞る (prefix 適用後のキー名) */
  keys?: string[];
  /** fetch 実装の差し替え (テスト用)。 既定は global fetch */
  fetchImpl?: typeof fetch;
  /** タイムアウト ms (既定 10000) */
  timeoutMs?: number;
};

/** agent 解決失敗の理由。 */
export type SecretAgentErrorCode =
  | 'no_token'
  | 'unauthorized'
  | 'no_mapping'
  | 'no_identity'
  | 'fetch_failed'
  | 'unreachable'
  | 'bad_response';

export class SecretAgentError extends Error {
  constructor(
    public readonly code: SecretAgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SecretAgentError';
  }
}
