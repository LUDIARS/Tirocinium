// Cernere の PASETO 公開鍵。CERNERE_PUBLIC_KEY が設定されていればそれを使い、無ければ起動時に
// {CERNERE_URL}/.well-known/cernere-public-key (現行 + ローテーション中の旧鍵、raw Ed25519 32 byte の base64)
// から取得する。取得できなければ鍵なしのまま (認証ミドルウェアは 503 を返し、黙って素通しにしない)。

import { createPublicKey, type KeyObject } from 'node:crypto';
import { config } from '../config.js';
import type { FetchLike } from './cernere-session.js';

let fetchedKeys: KeyObject[] = [];

/** raw 32 byte の Ed25519 公開鍵 (base64) を KeyObject にする。 */
export function ed25519FromRaw(base64: string): KeyObject {
  const raw = Buffer.from(base64, 'base64');
  if (raw.length !== 32) throw new Error(`Ed25519 public key must be 32 bytes (got ${raw.length})`);
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
}

export function parsePublicKeySet(body: unknown): KeyObject[] {
  const keys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) return [];
  return keys
    .filter((k): k is { public_key: string; alg?: string } => typeof (k as { public_key?: unknown })?.public_key === 'string')
    .filter((k) => !k.alg || k.alg === 'EdDSA')
    .map((k) => ed25519FromRaw(k.public_key));
}

/** 検証に使う鍵 (設定値を優先)。 */
export function verificationKeys(): (string | KeyObject)[] {
  return config.cernerePublicKey ? [config.cernerePublicKey] : fetchedKeys;
}

export async function loadCernerePublicKeys(fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<void> {
  if (config.cernerePublicKey || !config.cernere.url) return;
  try {
    const res = await fetchImpl(`${config.cernere.url}/.well-known/cernere-public-key`, { method: 'GET', headers: {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fetchedKeys = parsePublicKeySet(await res.json());
    console.log(`[auth] Cernere public keys loaded: ${fetchedKeys.length}`);
  } catch (err) {
    console.warn('[auth] Cernere public key fetch failed (auth stays disabled)', (err as Error).message);
  }
}

/** テスト用。 */
export function setFetchedKeysForTest(keys: KeyObject[]): void {
  fetchedKeys = keys;
}
