// Tirocinium ローカル暗号化 config ストア。
// @ludiars/encrypted-config を利用した薄いラッパー。

import {
  resolveConfigPath,
  resolveMasterSecret,
  readConfigFile as _readConfigFile,
  writeConfigFile as _writeConfigFile,
  readConfig,
  setConfig,
  deleteConfig,
  type ConfigFile,
  type StoreOptions,
} from '@ludiars/encrypted-config';
import type { ResolvedSecrets } from './types.js';

export type { EncryptedBlob } from '@ludiars/encrypted-config';
export type LocalConfigFile = ConfigFile;

/** 暗号化して保存するキー (API キー / Bot トークン / 証明書)。それ以外は plain に保存。 */
export const LOCAL_SECRET_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'TIROCINIUM_DISCORD_BOT_TOKEN',
  'NUNTIUS_API_KEY',
  'CERNERE_PUBLIC_KEY',
  'GOOGLE_MAPS_API_KEY',
  'GBIZINFO_TOKEN',
]);

const STORE_OPTS: StoreOptions = {
  secretKeys: LOCAL_SECRET_KEYS,
  configPathEnv: 'TIROCINIUM_CONFIG_PATH',
  masterKeyEnv: 'TIROCINIUM_MASTER_KEY',
  defaultConfigFile: 'tirocinium.config.json',
  masterSecretPrefix: 'tirocinium',
};

/** config ファイルパス: env TIROCINIUM_CONFIG_PATH → リポ直下 tirocinium.config.json。 */
export function localConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolveConfigPath(STORE_OPTS, env);
}

/** master secret: env TIROCINIUM_MASTER_KEY → マシン束縛値。 */
export function masterSecret(env: NodeJS.ProcessEnv = process.env): string {
  return resolveMasterSecret(STORE_OPTS, env);
}

/** config ファイルを読む。未存在 / 破損なら空 config 扱い。 */
export function readConfigFile(env: NodeJS.ProcessEnv = process.env): ConfigFile {
  return _readConfigFile(STORE_OPTS, env);
}

/** config ファイルを書く (2-space JSON)。 */
export function writeConfigFile(cfg: ConfigFile, env: NodeJS.ProcessEnv = process.env): void {
  _writeConfigFile(cfg, STORE_OPTS, env);
}

/**
 * 全 config を読んで平文 map を返す (シークレットは復号)。
 * ファイル未存在 → null。
 */
export function readLocalSecrets(env: NodeJS.ProcessEnv = process.env): ResolvedSecrets | null {
  return readConfig(STORE_OPTS, env);
}

/** 1 キーを config ファイルに書く。LOCAL_SECRET_KEYS なら暗号化、それ以外は平文。 */
export function setLocalConfig(key: string, value: string, env: NodeJS.ProcessEnv = process.env): void {
  setConfig(key, value, STORE_OPTS, env);
}

/** 1 キーを config ファイルから削除。 */
export function deleteLocalConfig(key: string, env: NodeJS.ProcessEnv = process.env): void {
  deleteConfig(key, STORE_OPTS, env);
}
