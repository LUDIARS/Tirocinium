// agent token の解決。 Excubitor 側と同じ規約 (env or token ファイル、 同一マシン前提)。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Excubitor が書く token ファイルのパス (同一マシンで共有)。 */
export function agentTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['EXCUBITOR_AGENT_TOKEN_PATH'];
  if (override && override.length > 0) return override;
  const base = env['APPDATA'] ?? env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
  return join(base, 'Excubitor', 'secret-agent.token');
}

/** agent token を解決する。 EXCUBITOR_AGENT_TOKEN → token ファイル。 無ければ null。 */
export function resolveAgentToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env['EXCUBITOR_AGENT_TOKEN'];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const t = readFileSync(agentTokenPath(env), 'utf8').trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/** agent の base URL を解決する。 */
export function resolveAgentBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env['EXCUBITOR_URL'] ?? 'http://127.0.0.1:17332').replace(/\/$/, '');
}
