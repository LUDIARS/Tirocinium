#!/usr/bin/env tsx
// sim-loop を 2 ライン (並列) で朝まで連続実行するバッチ。
// 面接官 × 受験者ペアを巡回し、各ペアで適応シミュレーション (sim-loop) を回す。
// 鍵不要 (sim-loop が claude CLI 駆動)。
//
//   npx tsx scripts/sim-batch --lines 2 --until 07:00 --rounds 3 --turns 6
//
// 停止: --until の時刻 (今日/翌日の最初に来る方) に達したら新規 run を止める。
// 進捗: data/training/sim-sessions/<date>/batch.log に追記。

import { spawn } from 'node:child_process';
import { readdir, mkdir, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

type Args = { lines: number; until: string; rounds: number; turns: number };

function parseArgs(argv: string[]): Args {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith('--')) continue;
    a[k.slice(2)] = argv[i + 1] ?? '';
    i++;
  }
  return {
    lines: Number.parseInt(a['lines'] ?? '2', 10),
    until: a['until'] ?? '07:00',
    rounds: Number.parseInt(a['rounds'] ?? '3', 10),
    turns: Number.parseInt(a['turns'] ?? '6', 10),
  };
}

/** "HH:MM" を、今から見て最初に来るその時刻の epoch(ms) に変換。 */
function untilMs(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => Number.parseInt(x, 10));
  const now = new Date();
  const t = new Date(now);
  t.setHours(h ?? 7, m ?? 0, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

async function listIds(kind: 'interviewer' | 'examinee'): Promise<string[]> {
  const dir = join(REPO_ROOT, 'data/general/persona', kind);
  return (await readdir(dir))
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => f.replace(/\.md$/, ''));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function runSim(interviewer: string, examinee: string, rounds: number, turns: number): Promise<number> {
  return new Promise((res) => {
    const child = spawn(
      'npx',
      ['tsx', 'scripts/sim-loop/index.ts', '--interviewer', interviewer, '--examinee', examinee,
        '--rounds', String(rounds), '--turns', String(turns)],
      { cwd: REPO_ROOT, shell: true, stdio: 'ignore' },
    );
    child.on('close', (code) => res(code ?? 1));
    child.on('error', () => res(1));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stopMs = untilMs(args.until);
  const interviewers = await listIds('interviewer');
  const examinees = await listIds('examinee');
  const pairs = shuffle(interviewers.flatMap((iv) => examinees.map((ex) => [iv, ex] as [string, string])));

  const date = new Date().toISOString().slice(0, 10);
  const logDir = join(REPO_ROOT, 'data/training/sim-sessions', date);
  await mkdir(logDir, { recursive: true });
  const logFile = join(logDir, 'batch.log');
  const log = async (s: string) => {
    const line = `[${new Date().toISOString()}] ${s}\n`;
    process.stdout.write(line);
    await appendFile(logFile, line);
  };

  await log(`sim-batch start: lines=${args.lines} until=${args.until} pairs=${pairs.length} rounds=${args.rounds} turns=${args.turns}`);

  let cursor = 0;
  let completed = 0;
  let failed = 0;
  const nextPair = (): [string, string] => pairs[cursor++ % pairs.length]!;

  async function worker(line: number): Promise<void> {
    while (Date.now() < stopMs) {
      const [iv, ex] = nextPair();
      await log(`L${line} start ${iv} × ${ex}`);
      const code = await runSim(iv, ex, args.rounds, args.turns);
      if (code === 0) completed++;
      else failed++;
      await log(`L${line} done  ${iv} × ${ex} (code=${code}) [完了=${completed} 失敗=${failed}]`);
    }
    await log(`L${line} stop (until reached)`);
  }

  await Promise.all(Array.from({ length: args.lines }, (_, i) => worker(i + 1)));
  await log(`sim-batch end: 完了=${completed} 失敗=${failed}`);
}

main().catch((err) => {
  console.error('[sim-batch] error:', err.message);
  process.exit(1);
});
