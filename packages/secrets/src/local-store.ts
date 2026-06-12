// ローカル暗号化 config ストア。
// Excubitor secret-agent が不在のスタンドアロン起動向け。
// 保存先: %APPDATA%\Tirocinium\<serviceCode>.enc (Windows)
//         ~/.config/Tirocinium/<serviceCode>.enc  (fallback)
//
// 暗号化: AES-256-GCM、鍵はマシン固有 ID から PBKDF2 導出。
// フォーマット: IV(12B) || authTag(16B) || ciphertext

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import type { ResolvedSecrets } from './types.js';

const PBKDF2_SALT = 'tirocinium-local-config-v1';
const PBKDF2_ITER = 100_000;

function getMachineId(): string {
  try {
    const out = execSync(
      'reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
    if (m?.[1]) return m[1];
  } catch {
    // ignore
  }
  return homedir();
}

function deriveKey(serviceCode: string): Buffer {
  const machineId = getMachineId();
  return pbkdf2Sync(`${machineId}:${serviceCode}`, PBKDF2_SALT, PBKDF2_ITER, 32, 'sha256');
}

export function localConfigPath(
  serviceCode: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env['TIROCINIUM_LOCAL_CONFIG_PATH'];
  if (override) return override;
  const base = env['APPDATA'] ?? join(homedir(), '.config');
  return join(base, 'Tirocinium', `${serviceCode}.enc`);
}

/** ローカル暗号化 config を読む。ファイルなし / 復号失敗なら null。 */
export function readLocalSecrets(
  serviceCode: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSecrets | null {
  try {
    const raw = readFileSync(localConfigPath(serviceCode, env));
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const key = deriveKey(serviceCode);
    const dec = createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(authTag);
    const plain = Buffer.concat([dec.update(ciphertext), dec.final()]).toString('utf8');
    return JSON.parse(plain) as ResolvedSecrets;
  } catch {
    return null;
  }
}

/** ローカル暗号化 config を書く。ディレクトリが無ければ作成する。 */
export function writeLocalSecrets(
  serviceCode: string,
  secrets: ResolvedSecrets,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = localConfigPath(serviceCode, env);
  mkdirSync(dirname(path), { recursive: true });
  const key = deriveKey(serviceCode);
  const iv = randomBytes(12);
  const enc = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([enc.update(JSON.stringify(secrets), 'utf8'), enc.final()]);
  const authTag = enc.getAuthTag();
  writeFileSync(path, Buffer.concat([iv, authTag, ciphertext]));
}
