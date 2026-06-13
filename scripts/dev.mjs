// Tirocinium dev ランチャー (Windows 向け)
//
// Quaestor/scripts/dev.mjs と同じ方針:
//   - 起動前に DEV_PORTS を掃除して EADDRINUSE を防ぐ (stale node の置き去り対策)
//   - migrate → seed-personas を一度だけ走らせる (SQLite 既定 / Docker 不要)
//   - server / desktop をサブプロセスとして起動し、[server]/[desktop] プレフィクスで出力
//   - 親プロセス終了時に taskkill /F /T でプロセスツリーごと kill する
//
// 旧 start-tirocinium.bat は cmd /k で 2 窓を開きっぱなしにしていたため、
// ポート掃除も一括終了もできず、再起動のたびに 8084/5178 を掴んだ node が残っていた。

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SERVER_PORT = 8084;
const DESKTOP_PORT = 5178;
const DEV_PORTS = [SERVER_PORT, DESKTOP_PORT];

// frontend (Vite) が build 時に読む env。bat と同じ既定値。
const FE_ENV = {
  ...process.env,
  VITE_DEV_AUTH: process.env.VITE_DEV_AUTH ?? '1',
  VITE_SERVER_URL: process.env.VITE_SERVER_URL ?? `http://localhost:${SERVER_PORT}`,
  VITE_WS_URL: process.env.VITE_WS_URL ?? `ws://localhost:${SERVER_PORT}`,
};

// ── ポート掃除 ────────────────────────────────────────
function killPort(port) {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue;
      const procId = line.trim().split(/\s+/).at(-1);
      if (!procId || !/^\d+$/.test(procId) || procId === '0') continue;
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', procId], { stdio: 'ignore' });
        console.log(`[dev] killed stale PID ${procId} on port ${port}`);
      } catch { /* already gone */ }
    }
  } catch { /* netstat unavailable */ }
}

console.log('[dev] cleaning up stale port bindings...');
for (const p of DEV_PORTS) killPort(p);

// ── migrate → seed (一度だけ・同期) ──────────────────────
function runOnce(label, args) {
  console.log(`[dev] ${label}...`);
  const r = spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`[dev] ${label} failed (exit ${r.status}) — aborting`);
    process.exit(r.status ?? 1);
  }
}

runOnce('migrate', ['run', 'migrate']);
runOnce('seed-personas', ['run', 'seed-personas']);

// ── 子プロセス起動 ────────────────────────────────────
const ANSI = { blue: '\x1b[34m', magenta: '\x1b[35m', reset: '\x1b[0m' };

function spawnPrefixed(label, color, cmd, args, env) {
  const pre = `${ANSI[color]}[${label}]${ANSI.reset} `;
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,          // Windows: cmd.exe でラップしないと npm スクリプトが動かない
    windowsHide: true,
  });
  child.stdout.on('data', (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, pre)));
  child.stderr.on('data', (d) => process.stderr.write(d.toString().replace(/^(?=.)/gm, pre)));
  child.on('exit', (code, sig) => {
    console.log(`${pre}exited (code=${code ?? sig})`);
  });
  return child;
}

console.log('[dev] starting server + desktop...');
console.log(`[dev]   server : http://localhost:${SERVER_PORT}`);
console.log(`[dev]   desktop: http://localhost:${DESKTOP_PORT}`);

const server = spawnPrefixed('server', 'blue', 'npm', ['run', 'dev:server'], process.env);
const desktop = spawnPrefixed('desktop', 'magenta', 'npm', ['run', 'dev:desktop'], FE_ENV);

// ── 終了ハンドラ ─────────────────────────────────────
function killAll(label) {
  console.log(`\n[dev] ${label} — killing process trees...`);
  for (const c of [server, desktop]) {
    if (c.pid == null) continue;
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(c.pid)], { stdio: 'ignore' });
    } catch { /* already dead */ }
  }
}

// Windows では SIGINT が子に自動伝播しないので明示的に処理する
process.on('SIGINT',  () => { killAll('SIGINT');  process.exit(0); });
process.on('SIGTERM', () => { killAll('SIGTERM'); process.exit(0); });
process.on('exit',    ()  => killAll('exit'));
