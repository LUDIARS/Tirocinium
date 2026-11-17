#!/usr/bin/env node
// 旧 Node 版の SQLite データ (移行 bundle) を、native の migration が作った Postgres へ移す。
// Castra service-bootstrap の import 契約に沿う:
//   node scripts/site/import-data.mjs --input <bundle の絶対パス> --sha256 <64 桁 hex> [--dry-run]
// 移し先は環境変数 DATABASE_URL (postgres://)。先に tirocinium-migrate でスキーマを作っておく。
//   --dry-run: 書き込まずに、表ごとの件数と変換できない行 (表 / rowid / 列 / 理由) だけを出す。
//   本番: 移し先の表がすべて空のときだけ、1 トランザクションで入れる (途中で失敗したら何も残らない)。
// bundle は scripts/site/pack-legacy-sqlite.mjs が作る。値・接続文字列は出力しない。終了コード 0 = 成功。

import postgres from 'postgres';
import { openBundle, verifyBundleFile } from './legacy-sqlite/bundle.mjs';
import { ImportStopped, runImport } from './legacy-sqlite/run-import.mjs';
import { formatReport } from './legacy-sqlite/report.mjs';

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i];
    else if (a === '--sha256') args.sha256 = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`不明な引数: ${a}`);
  }
  if (!args.input || !args.sha256) throw new Error('使い方: import-data.mjs --input <絶対パス> --sha256 <hex> [--dry-run]');
  return args;
}

function databaseUrl() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('DATABASE_URL (postgres://) が設定されていない');
  return url;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = databaseUrl();
  await verifyBundleFile(args.input, args.sha256);
  const db = openBundle(args.input);
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const report = await runImport({ db, sql, dryRun: args.dryRun });
    console.log(formatReport(report));
    console.log(args.dryRun ? 'dry-run: 投入できる状態' : '投入した');
  } catch (e) {
    if (e instanceof ImportStopped) {
      console.log(formatReport(e.report));
      console.error(`止めた: ${e.message} (何も書いていない)`);
      process.exitCode = 1;
      return;
    }
    throw e;
  } finally {
    await sql.end({ timeout: 5 });
    db.close();
  }
}

main().catch((e) => {
  // postgres のエラーに接続文字列は入らないが、念のため message だけを出す。
  console.error(`失敗: ${e?.message ?? e}`);
  process.exitCode = 1;
});
