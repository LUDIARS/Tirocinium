// 非公開 Google Sheet を service account で読む最小コネクタ (外部 SDK 不使用)。
// service account JSON で署名した JWT (RS256) → access token → Sheets values API。
// 読み取り専用スコープ。 Sheet は対象 service account のメールに共有しておく必要がある。
// creds は secret 経由 (リポ非コミット)。 spec/feature/companies/game-graph.md §5.3。

import { createSign } from 'node:crypto';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const JWT_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

export type ServiceAccount = { client_email: string; private_key: string; token_uri: string };

/** fetch を DI 可能にして token / 値取得をテストできるようにする。 */
export type FetchLike = typeof fetch;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** service account JSON 文字列をパースする。 必須項目欠落は明示エラー。 */
export function parseServiceAccount(json: string): ServiceAccount {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('service account JSON のパースに失敗しました');
  }
  const client_email = String(obj['client_email'] ?? '');
  const private_key = String(obj['private_key'] ?? '');
  if (!client_email || !private_key) {
    throw new Error('service account JSON に client_email / private_key がありません');
  }
  const token_uri = typeof obj['token_uri'] === 'string' && obj['token_uri'] ? (obj['token_uri'] as string) : TOKEN_URI;
  return { client_email, private_key, token_uri };
}

/** service account で署名した JWT を作る (有効 1 時間)。 nowSec は秒 epoch。 */
function buildJwt(sa: ServiceAccount, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri, iat: nowSec, exp: nowSec + 3600 }),
  );
  const signingInput = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  return `${signingInput}.${b64url(signer.sign(sa.private_key))}`;
}

/** JWT bearer グラントで access token を取得する。 */
export async function getAccessToken(sa: ServiceAccount, fetchImpl: FetchLike = fetch): Promise<string> {
  const jwt = buildJwt(sa, Math.floor(Date.now() / 1000));
  const body = new URLSearchParams({ grant_type: JWT_GRANT, assertion: jwt });
  const res = await fetchImpl(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`access token 取得失敗 ${res.status}: ${await res.text().catch(() => '')}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('token レスポンスに access_token がありません');
  return j.access_token;
}

/**
 * 非公開 Sheet の指定レンジを 2 次元文字列配列で読む。
 * 値は全て文字列に正規化する (Sheets は数値を number で返すため)。
 */
export async function readSheetValues(
  opts: { serviceAccountJson: string; spreadsheetId: string; range: string },
  fetchImpl: FetchLike = fetch,
): Promise<string[][]> {
  const sa = parseServiceAccount(opts.serviceAccountJson);
  const token = await getAccessToken(sa, fetchImpl);
  const url = `${SHEETS_API}/${encodeURIComponent(opts.spreadsheetId)}/values/${encodeURIComponent(opts.range)}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets 読み取り失敗 ${res.status}: ${await res.text().catch(() => '')}`);
  const j = (await res.json()) as { values?: unknown[][] };
  const values = Array.isArray(j.values) ? j.values : [];
  return values.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')) : []));
}
