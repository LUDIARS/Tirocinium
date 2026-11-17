// node:sqlite の読み込みと、SQLite 側の表・列の一覧。
// node:sqlite は Node 24 でも experimental の警告を出すので、その 1 件だけを黙らせる (他の警告は出す)。

import { createRequire } from 'node:module';

const originalEmit = process.emitWarning;
process.emitWarning = function emitWarning(warning, ...rest) {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (typeof text === 'string' && text.startsWith('SQLite is an experimental feature')) return;
  return originalEmit.call(process, warning, ...rest);
};
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
process.emitWarning = originalEmit;

export function openSqlite(location, options = {}) {
  const db = new DatabaseSync(location, options);
  db.exec('PRAGMA trusted_schema = OFF');
  return db;
}

export function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/** 利用者の表の名前 (sqlite_ で始まる内部の表を除く)。 */
export function listTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
    .all()
    .map((r) => r.name);
}

/** SQLite が内部で持つ表 (sqlite_sequence など)。移行の対象外だが、一覧には出す。 */
export function listInternalTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name")
    .all()
    .map((r) => r.name);
}

export function listColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((c) => c.name);
}

export function countRows(db, table) {
  return Number(db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(table)}`).get().n);
}

/** 行を rowid 順に読む (行番号 = rowid を報告に使う。値は報告しない)。 */
export function* iterateRows(db, table, columns) {
  const list = columns.map(quoteIdent).join(', ');
  const stmt = db.prepare(`SELECT rowid AS __rowid, ${list} FROM ${quoteIdent(table)} ORDER BY rowid`);
  stmt.setReadBigInts(true);
  for (const row of stmt.iterate()) yield row;
}
