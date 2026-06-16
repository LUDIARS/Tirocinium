import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { parseServiceAccount, getAccessToken, readSheetValues, type FetchLike } from './google-sheets.js';

/** テスト用の service account JSON (実 RSA 鍵で署名検証できる)。 */
function fakeServiceAccountJson(): { json: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const json = JSON.stringify({
    type: 'service_account',
    client_email: 'sa@example.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: 'https://oauth2.googleapis.com/token',
  });
  return { json, publicKey };
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

describe('parseServiceAccount', () => {
  it('client_email / private_key を取り出す', () => {
    const { json } = fakeServiceAccountJson();
    const sa = parseServiceAccount(json);
    expect(sa.client_email).toBe('sa@example.iam.gserviceaccount.com');
    expect(sa.private_key).toContain('PRIVATE KEY');
    expect(sa.token_uri).toContain('oauth2.googleapis.com');
  });

  it('必須欠落 / 不正 JSON は明示エラー', () => {
    expect(() => parseServiceAccount('{}')).toThrow(/client_email/);
    expect(() => parseServiceAccount('not-json')).toThrow(/パース/);
  });
});

describe('getAccessToken', () => {
  it('RS256 署名つき JWT bearer で token を要求し、 署名が SA 公開鍵で検証できる', async () => {
    const { json, publicKey } = fakeServiceAccountJson();
    const sa = parseServiceAccount(json);
    let sentBody = '';
    const fetchImpl: FetchLike = (async (_url: string, init?: RequestInit) => {
      sentBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ access_token: 'tok-123' }), { status: 200 });
    }) as unknown as FetchLike;

    const token = await getAccessToken(sa, fetchImpl);
    expect(token).toBe('tok-123');

    const params = new URLSearchParams(sentBody);
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const jwt = params.get('assertion')!;
    const [h, c, sig] = jwt.split('.');
    // ヘッダは RS256
    expect(JSON.parse(b64urlToBuf(h!).toString())).toMatchObject({ alg: 'RS256', typ: 'JWT' });
    // claim に scope / iss
    expect(JSON.parse(b64urlToBuf(c!).toString())).toMatchObject({
      iss: 'sa@example.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    });
    // 署名検証
    const verify = createVerify('RSA-SHA256');
    verify.update(`${h}.${c}`);
    expect(verify.verify(publicKey, b64urlToBuf(sig!))).toBe(true);
  });

  it('token エンドポイントが非 OK なら throw', async () => {
    const { json } = fakeServiceAccountJson();
    const sa = parseServiceAccount(json);
    const fetchImpl: FetchLike = (async () => new Response('nope', { status: 401 })) as unknown as FetchLike;
    await expect(getAccessToken(sa, fetchImpl)).rejects.toThrow(/access token 取得失敗 401/);
  });
});

describe('readSheetValues', () => {
  it('token 取得 → values API で 2 次元配列を返し、 数値も文字列に正規化する', async () => {
    const { json } = fakeServiceAccountJson();
    const calls: string[] = [];
    const fetchImpl: FetchLike = (async (url: string) => {
      calls.push(url);
      if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
      return new Response(JSON.stringify({ values: [['氏名', '入社年'], ['山田', 2024]] }), { status: 200 });
    }) as unknown as FetchLike;

    const values = await readSheetValues(
      { serviceAccountJson: json, spreadsheetId: 'sheet-1', range: 'A:B' },
      fetchImpl,
    );
    expect(values).toEqual([['氏名', '入社年'], ['山田', '2024']]); // 2024(number) → '2024'
    expect(calls.some((u) => u.includes('/values/A%3AB'))).toBe(true);
  });

  it('Sheets API 非 OK は throw', async () => {
    const { json } = fakeServiceAccountJson();
    const fetchImpl: FetchLike = (async (url: string) => {
      if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
      return new Response('forbidden', { status: 403 });
    }) as unknown as FetchLike;
    await expect(
      readSheetValues({ serviceAccountJson: json, spreadsheetId: 's', range: 'A:B' }, fetchImpl),
    ).rejects.toThrow(/Sheets 読み取り失敗 403/);
  });
});
