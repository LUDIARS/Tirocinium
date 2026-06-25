// crawl-queue worker から子クローラ (CLI) を detached spawn する。
// detached 子の stdout/stderr はファイル fd に固定する (親終了後もログを残すため)。
// Windows でも動くよう shell:true + コマンド文字列で起動する (引数は UUID のみで安全)。

import { spawn } from 'node:child_process';
import { openSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markChildSpawned } from './crawl-queue-repo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// apps/server/{src|dist}/companies → リポジトリルート
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const LOG_DIR = join(REPO_ROOT, 'logs', 'company-enrich');

// 子エントリ (enrich-cli) は spawner と同じディレクトリに co-located。 実行形態を自分の拡張子で判定し、
// dev(.ts)は tsx、 本番(node dist の .js)は node で直接実行する (本番に tsx が無くても動く)。
const COMPILED = __filename.endsWith('.js');
const CHILD_ENTRY = join(__dirname, `enrich-cli.${COMPILED ? 'js' : 'ts'}`);
const CHILD_RUNNER = COMPILED ? 'node' : 'npx tsx';

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
    const cmd = `${CHILD_RUNNER} "${CHILD_ENTRY}" --company-id ${companyId} --job-id ${jobId}`;
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
