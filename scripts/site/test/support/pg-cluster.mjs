// テスト用の一時 Postgres クラスタ (native/tools/pg_test_cluster.sh 相当を Node で)。
// initdb / pg_ctl は TR_PG_BIN、無ければ Windows の既定 (C:/Program Files/PostgreSQL/18/bin)、それ以外は PATH から探す。
// データは短いパスの一時ディレクトリだけに置き、unix socket は使わない (Windows のパス長の上限を避ける)。
// 本物の DB には接続しない。見つからなければ null を返す (テストは skip する)。

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function pgBin() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const candidates = [process.env.TR_PG_BIN, process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : null];
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, `initdb${exe}`))) return (name) => join(dir, `${name}${exe}`);
  }
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['initdb'], { stdio: 'ignore' });
    return (name) => name;
  } catch {
    return null;
  }
}

/** 一時クラスタを起動し { baseUrl(db), createDatabase(name), stop() } を返す。 */
export async function startTestCluster() {
  const bin = pgBin();
  if (!bin) return null;
  const dir = mkdtempSync(join(tmpdir(), 'trpg-'));
  const port = 56000 + Math.floor(Math.random() * 900);
  // pg_ctl start が起こす postgres は標準出力を引き継ぐので、pipe にすると終わりを待ち続ける。出力は捨てる (ログは server.log)。
  const run = (name, args) => execFileSync(bin(name), args, { stdio: 'ignore', windowsHide: true, timeout: 120000 });
  run('initdb', ['-D', dir, '-U', 'tirocinium', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  appendFileSync(join(dir, 'postgresql.conf'), `\nport = ${port}\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nfsync = off\n`);
  run('pg_ctl', ['-D', dir, '-l', join(dir, 'server.log'), '-w', 'start']);
  const baseUrl = (db) => `postgres://tirocinium@127.0.0.1:${port}/${db}`;
  return {
    baseUrl,
    async createDatabase(sql, name) {
      await sql.unsafe(`CREATE DATABASE "${name}"`);
      return baseUrl(name);
    },
    stop() {
      try {
        run('pg_ctl', ['-D', dir, '-m', 'fast', '-w', 'stop']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
