// crawl-queue worker から子クローラ (CLI) を detached spawn する。
// detached 子の stdout/stderr はファイル fd に固定する (親終了後もログを残すため)。
// Windows でも動くよう shell:true + コマンド文字列で起動する (引数は UUID のみで安全)。

import { spawn } from 'node:child_process';
import { openSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markChildSpawned } from './crawl-queue-repo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/server/src/companies → リポジトリルート
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'company-enrich', 'index.ts');
const LOG_DIR = join(REPO_ROOT, 'logs', 'company-enrich');

/** UUID 形式のみ許可 (spawn コマンド文字列に渡すため、 念のため検証)。 */
function isUuid(v: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(v);
}

/**
 * 企業 1 社の子クローラを detached 起動する (cli backend)。 失敗しても親 (worker) は止めない。
 * @returns 起動できたら true。
 */
export function spawnChildEnrich(jobId: string, companyId: string): boolean {
  if (!isUuid(jobId) || !isUuid(companyId)) return false;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const logPath = join(LOG_DIR, `${jobId}.log`);
    const fd = openSync(logPath, 'a');
    const cmd = `npx tsx "${SCRIPT}" --company-id ${companyId} --job-id ${jobId}`;
    const child = spawn(cmd, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, TIROCINIUM_LLM_BACKEND: 'cli' },
      shell: true,
      windowsHide: true,
    });
    child.unref();
    void markChildSpawned(jobId, logPath).catch(() => {});
    console.log(`[crawl-queue] 子クローラ spawn: company=${companyId} log=${logPath}`);
    return true;
  } catch (err) {
    console.warn('[crawl-queue] 子クローラ spawn 失敗:', (err as Error).message);
    return false;
  }
}
