// Tirocinium dev ランチャー (Windows / macOS / Linux 対応)
//
// Quaestor/scripts/dev.mjs と同じ方針:
//   - 起動前に DEV_PORTS を掃除して EADDRINUSE を防ぐ (stale node の置き去り対策)
//   - migrate → seed-personas を一度だけ走らせる (SQLite 既定 / Docker 不要)
//   - server / desktop をサブプロセスとして起動し、[server]/[desktop] プレフィクスで出力
//   - 親プロセス終了時に子のプロセスツリーごと kill する
//
// 旧 start-tirocinium.bat は cmd /k で 2 窓を開きっぱなしにしていたため、
// ポート掃除も一括終了もできず、再起動のたびに 8084/5178 を掴んだ node が残っていた。
//
// プラットフォーム差分:
//   - ポート掃除  : Windows = netstat + taskkill / それ以外 = lsof + kill
//   - ツリー kill : Windows = taskkill /F /T   / それ以外 = detached 子のプロセスグループを kill(-pid)
// Mac から起動するときは `npm run dev`、もしくはルートの start-tirocinium.command を
// ダブルクリックする。

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const IS_WIN = process.platform === 'win32';

const SERVER_PORT = 8084;
const DESKTOP_PORT = 5178;
const DEV_PORTS = [SERVER_PORT, DESKTOP_PORT];

// frontend (Vite) env。
// API/WS は同一オリジン (Vite proxy → server) で受けるので VITE_SERVER_URL/VITE_WS_URL は
// 設定しない (絶対 URL を入れるとブラウザがクロスオリジンになり CORS で弾かれる)。
// proxy の転送先だけ VITE_PROXY_TARGET で渡す (vite.config.ts が参照)。
const FE_ENV = { ...process.env };
delete FE_ENV.VITE_SERVER_URL;
delete FE_ENV.VITE_WS_URL;
FE_ENV.VITE_DEV_AUTH = process.env.VITE_DEV_AUTH ?? '1';
FE_ENV.VITE_PROXY_TARGET = process.env.VITE_PROXY_TARGET ?? `http://localhost:${SERVER_PORT}`;

// ── ポート掃除 ────────────────────────────────────────
function killPidUnix(procId, port) {
  try {
    execFileSync('kill', ['-9', procId], { stdio: 'ignore' });
    console.log(`[dev] killed stale PID ${procId} on port ${port}`);
  } catch { /* already gone */ }
}

function killPort(port) {
  if (IS_WIN) {
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
    return;
  }
  // macOS / Linux: LISTEN しているプロセスの PID を lsof で引いて kill する。
  // (該当なしのとき lsof は exit 1 → catch で握りつぶす)
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    for (const procId of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!/^\d+$/.test(procId)) continue;
      killPidUnix(procId, port);
    }
  } catch { /* lsof: 該当なし or 未インストール */ }
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
    shell: true,            // npm スクリプトはシェル経由でないと解決できない
    windowsHide: true,
    // 非 Windows: 独立したプロセスグループを作り、終了時に kill(-pid) でツリーごと落とす
    detached: !IS_WIN,
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
function killChild(child) {
  if (child.pid == null) return;
  if (IS_WIN) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } catch { /* already dead */ }
  } else {
    // detached で起動したので、PID = プロセスグループ ID。負の PID でグループごと kill。
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try { process.kill(child.pid, 'SIGKILL'); } catch { /* already dead */ }
    }
  }
}

let killing = false;
function killAll(label) {
  if (killing) return;       // exit ハンドラとシグナルの二重発火を防ぐ
  killing = true;
  console.log(`\n[dev] ${label} — killing process trees...`);
  for (const c of [server, desktop]) killChild(c);
}

// SIGINT は子に自動伝播しない (Windows) / グループを分けた (非 Windows) ので明示処理する
process.on('SIGINT',  () => { killAll('SIGINT');  process.exit(0); });
process.on('SIGTERM', () => { killAll('SIGTERM'); process.exit(0); });
process.on('exit',    ()  => killAll('exit'));
