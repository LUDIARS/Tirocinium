// ローカル暗号化 config ストア (Canalis 方式)。
//
// 保存先: リポジトリ直下 tirocinium.config.json (gitignore 済)。
//         env override: TIROCINIUM_CONFIG_PATH
//
// フォーマット: { plain: Record<string,string>, secrets: Record<string,EncryptedBlob> }
//   - 非シークレット (port / host / backend 等) は plain に平文保存。
//   - シークレット (API キー / Bot トークン) は AES-256-GCM EncryptedBlob として保存。
//
// master secret: env TIROCINIUM_MASTER_KEY → マシン束縛値 (tirocinium:hostname:user)。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { encryptJson, decryptJson, isEncryptedBlob, type EncryptedBlob } from './crypto.js';
import type { ResolvedSecrets } from './types.js';

export type { EncryptedBlob };

/** config ファイルのディスク上フォーマット。 */
export interface LocalConfigFile {
  /** 非シークレット: 平文文字列マップ。 */
  plain: Record<string, string>;
  /** シークレット: AES-256-GCM EncryptedBlob マップ。 */
  secrets: Record<string, EncryptedBlob>;
}

/** 暗号化して保存するキー (API キー / Bot トークン / 証明書)。それ以外は plain に保存。 */
export const LOCAL_SECRET_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'TIROCINIUM_DISCORD_BOT_TOKEN',
  'NUNTIUS_API_KEY',
  'CERNERE_PUBLIC_KEY',
]);

/** config ファイルパス: env TIROCINIUM_CONFIG_PATH → リポ直下 tirocinium.config.json。 */
export function localConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['TIROCINIUM_CONFIG_PATH'];
  if (override && override.length > 0) return override;
  return join(process.cwd(), 'tirocinium.config.json');
}

/** master secret: env TIROCINIUM_MASTER_KEY → マシン束縛値。 */
export function masterSecret(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['TIROCINIUM_MASTER_KEY'];
  if (override && override.length > 0) return override;
  return `tirocinium:${hostname()}:${userInfo().username}`;
}

/** config ファイルを読む。未存在 / 破損なら空 config 扱い。 */
export function readConfigFile(env: NodeJS.ProcessEnv = process.env): LocalConfigFile {
  const path = localConfigPath(env);
  if (!existsSync(path)) return { plain: {}, secrets: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LocalConfigFile;
    return {
      plain: parsed.plain && typeof parsed.plain === 'object' ? parsed.plain : {},
      secrets: parsed.secrets && typeof parsed.secrets === 'object' ? parsed.secrets : {},
    };
  } catch {
    return { plain: {}, secrets: {} };
  }
}

/** config ファイルを書く (2-space JSON)。 */
export function writeConfigFile(cfg: LocalConfigFile, env: NodeJS.ProcessEnv = process.env): void {
  const path = localConfigPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

/**
 * 全 config を読んで平文 map を返す (シークレットは復号)。
 * ファイル未存在 → null。復号失敗キーは skip (master 鍵変更時等)。
 */
export function readLocalSecrets(env: NodeJS.ProcessEnv = process.env): ResolvedSecrets | null {
  if (!existsSync(localConfigPath(env))) return null;
  const cfg = readConfigFile(env);
  const ms = masterSecret(env);
  const out: ResolvedSecrets = { ...cfg.plain };
  for (const [key, blob] of Object.entries(cfg.secrets)) {
    if (!isEncryptedBlob(blob)) continue;
    try {
      out[key] = decryptJson<string>(blob, ms);
    } catch {
      // master 鍵変更 / 改竄時は無視
    }
  }
  return out;
}

/** 1 キーを config ファイルに書く。LOCAL_SECRET_KEYS なら暗号化、それ以外は平文。 */
export function setLocalConfig(key: string, value: string, env: NodeJS.ProcessEnv = process.env): void {
  const cfg = readConfigFile(env);
  if (LOCAL_SECRET_KEYS.has(key)) {
    cfg.secrets[key] = encryptJson(value, masterSecret(env));
    delete cfg.plain[key];
  } else {
    cfg.plain[key] = value;
    delete cfg.secrets[key];
  }
  writeConfigFile(cfg, env);
}

/** 1 キーを config ファイルから削除。 */
export function deleteLocalConfig(key: string, env: NodeJS.ProcessEnv = process.env): void {
  const cfg = readConfigFile(env);
  delete cfg.plain[key];
  delete cfg.secrets[key];
  writeConfigFile(cfg, env);
}
