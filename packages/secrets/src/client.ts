// Excubitor secret-agent クライアント。 service code → resolved secret map (memory-only)。

import {
  SecretAgentError,
  type ResolveOptions,
  type ResolvedSecrets,
} from './types.js';
import { resolveAgentBaseUrl, resolveAgentToken } from './token.js';

/** agent レスポンス JSON を ResolvedSecrets に検証する。 純粋関数。 */
export function parseResolveResponse(json: unknown): ResolvedSecrets {
  const obj = (json ?? {}) as { secrets?: unknown };
  if (!obj.secrets || typeof obj.secrets !== 'object') {
    throw new SecretAgentError('bad_response', 'agent response missing secrets object');
  }
  const out: ResolvedSecrets = {};
  for (const [k, v] of Object.entries(obj.secrets as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** HTTP status → SecretAgentError code。 */
function statusToCode(status: number): SecretAgentError['code'] {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 404:
      return 'no_mapping';
    case 503:
      return 'no_identity';
    default:
      return 'fetch_failed';
  }
}

/**
 * service code に対応する secret を Excubitor secret-agent から取得する。
 * 値は戻り値 (process memory) でのみ返り、 env / ファイルには書かない。
 *
 * @throws SecretAgentError (no_token / unreachable / unauthorized / no_mapping / no_identity / ...)
 */
export async function resolveSecrets(
  serviceCode: string,
  opts: ResolveOptions = {},
): Promise<ResolvedSecrets> {
  const baseUrl = opts.baseUrl ?? resolveAgentBaseUrl();
  const token = opts.token ?? resolveAgentToken();
  if (!token) {
    throw new SecretAgentError(
      'no_token',
      'agent token not found (set EXCUBITOR_AGENT_TOKEN or ensure secret-agent.token exists)',
    );
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);

  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/v1/secrets/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ service: serviceCode, keys: opts.keys }),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new SecretAgentError(
      'unreachable',
      `secret-agent unreachable at ${baseUrl}: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SecretAgentError(statusToCode(res.status), `agent ${res.status}: ${text.slice(0, 200)}`);
  }
  return parseResolveResponse(await res.json());
}
