#!/usr/bin/env node
// 旧 Node 版の SQLite (data/tirocinium.sqlite と data/companies.sqlite) を、移行 bundle (1 つの SQLite ファイル) にまとめる。
//   node scripts/site/pack-legacy-sqlite.mjs --output <絶対パス> [--main <path>] [--companies <path>]
// 既定の入力は data/tirocinium.sqlite と data/companies.sqlite (cwd = リポジトリ直下)。companies は無ければ省く。
// 入力は読み取り専用で開き、VACUUM INTO で整合した写しを作る (稼働中の DB の生ファイルをコピーしない)。
// それでも書き込み中の Node 版と同時に走らせない (先に Node 版を止める)。出力が既にあれば失敗する。
// 最後に出力の SHA-256 を出す (import-data.mjs の --sha256 に渡す)。値は出力しない。

import { existsSync, unlinkSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  BUNDLE_FORMAT,
  BUNDLE_META_TABLE,
  BUNDLE_SERVICE,
  BUNDLE_VERSION,
  COMPANIES_PREFIX,
  sha256File,
} from './legacy-sqlite/bundle.mjs';
import { countRows, listTables, openSqlite, quoteIdent } from './legacy-sqlite/sqlite.mjs';

function parseArgs(argv) {
  const args = { main: 'data/tirocinium.sqlite', companies: 'data/companies.sqlite' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--output') args.output = argv[++i];
    else if (a === '--main') args.main = argv[++i];
    else if (a === '--companies') args.companies = argv[++i];
    else throw new Error(`不明な引数: ${a}`);
  }
  if (!args.output || !isAbsolute(args.output)) throw new Error('--output に絶対パスを指定する');
  return args;
}

/** companies.sqlite の表を、接頭辞を付けた名前で bundle に写す (列の宣言型だけを持つ表として)。 */
function copyCompanies(out, companiesPath) {
  const src = openSqlite(companiesPath, { readOnly: true });
  try {
    for (const table of listTables(src)) {
      const cols = src.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
      const target = quoteIdent(COMPANIES_PREFIX + table);
      out.exec(`CREATE TABLE ${target} (${cols.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(', ')})`);
      const names = cols.map((c) => quoteIdent(c.name)).join(', ');
      const insert = out.prepare(`INSERT INTO ${target} (${names}) VALUES (${cols.map(() => '?').join(', ')})`);
      const read = src.prepare(`SELECT ${names} FROM ${quoteIdent(table)} ORDER BY rowid`);
      read.setReadBigInts(true);
      for (const row of read.iterate()) insert.run(...cols.map((c) => row[c.name]));
      console.log(`companies.sqlite ${table}: ${countRows(src, table)} 行`);
    }
  } finally {
    src.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = resolve(args.output);
  if (existsSync(output)) throw new Error('--output が既にある (上書きしない)');
  const mainPath = resolve(args.main);
  if (!existsSync(mainPath)) throw new Error('tirocinium.sqlite が見つからない');

  const src = openSqlite(mainPath, { readOnly: true });
  try {
    src.prepare('VACUUM INTO ?').run(output);
  } finally {
    src.close();
  }
  try {
    fillBundle(output, args);
  } catch (e) {
    unlinkSync(output); // 途中まで作った bundle は残さない (このスクリプトが作ったファイル)
    throw e;
  }
  console.log(`bundle: ${output}`);
  console.log(`sha256: ${await sha256File(output)}`);
}

function fillBundle(output, args) {
  const out = openSqlite(output);
  try {
    out.exec('BEGIN');
    for (const t of listTables(out)) {
      if (t.startsWith(COMPANIES_PREFIX) || t === BUNDLE_META_TABLE) throw new Error(`tirocinium.sqlite に予約した名前の表がある: ${t}`);
      console.log(`tirocinium.sqlite ${t}: ${countRows(out, t)} 行`);
    }
    out.exec(`CREATE TABLE ${quoteIdent(BUNDLE_META_TABLE)} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const meta = out.prepare(`INSERT INTO ${quoteIdent(BUNDLE_META_TABLE)} (key, value) VALUES (?, ?)`);
    for (const [k, v] of [
      ['service', BUNDLE_SERVICE],
      ['format', BUNDLE_FORMAT],
      ['version', BUNDLE_VERSION],
      ['created_at', new Date().toISOString()],
    ]) {
      meta.run(k, v);
    }
    const companiesPath = resolve(args.companies);
    if (existsSync(companiesPath)) copyCompanies(out, companiesPath);
    else console.log('companies.sqlite: 無い (省いた)');
    out.exec('COMMIT');
  } catch (e) {
    out.exec('ROLLBACK');
    throw e;
  } finally {
    out.close();
  }
}

main().catch((e) => {
  console.error(`失敗: ${e?.message ?? e}`);
  process.exitCode = 1;
});
