// 移し先の Postgres: スキーマの読み取り、空であることの確認、外部キーの順の決定、
// まとめての INSERT と、serial の sequence を移した最大値に合わせる処理。
// 接続文字列は DATABASE_URL から読み、出力しない。

import { quoteIdent } from './sqlite.mjs';
import { castFor } from './convert.mjs';

export const MIGRATIONS_TABLE = '_tirocinium_migrations';
const MAX_PARAMS = 30000; // 1 文の引数の上限 (Postgres は 65535) より十分小さく

/** public schema の表と列 ({ udtName, nullable, hasDefault, serial })。 */
export async function readTargetSchema(sql) {
  const rows = await sql`
    SELECT c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default, c.is_identity
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position`;
  const schema = {};
  for (const r of rows) {
    const table = (schema[r.table_name] ??= { columns: {} });
    table.columns[r.column_name] = {
      udtName: r.udt_name,
      nullable: r.is_nullable === 'YES',
      hasDefault: r.column_default !== null || r.is_identity === 'YES',
      serial: typeof r.column_default === 'string' && r.column_default.startsWith('nextval('),
      identity: r.is_identity === 'YES',
    };
  }
  return schema;
}

/** migration が当たっていること。当たっていなければ止める (このスクリプトはスキーマを作らない)。 */
export function assertMigrated(schema) {
  if (!schema[MIGRATIONS_TABLE]) {
    throw new Error('Postgres に migration が当たっていない。先に tirocinium-migrate を流す');
  }
}

/** 行のある表 (migration の記録を除く)。本番の投入は全部が空のときだけ行う。 */
export async function nonEmptyTables(sql, schema) {
  const out = [];
  for (const table of Object.keys(schema)) {
    if (table === MIGRATIONS_TABLE) continue;
    const [{ present }] = await sql.unsafe(`SELECT EXISTS (SELECT 1 FROM ${quoteIdent(table)}) AS present`);
    if (present) out.push(table);
  }
  return out;
}

/** 外部キーの親を先に並べる (自分自身への参照と循環は止める)。 */
export async function insertOrder(sql, tables) {
  const fks = await sql`
    SELECT cl.relname AS child, pl.relname AS parent
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class pl ON pl.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'`;
  const wanted = new Set(tables);
  const parents = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of fks) {
    if (!wanted.has(child) || !wanted.has(parent)) continue;
    if (child === parent) throw new Error(`表 ${child} が自分自身を参照している (順序を決められない)`);
    parents.get(child).add(parent);
  }
  const order = [];
  const done = new Set();
  const visiting = new Set();
  const visit = (t) => {
    if (done.has(t)) return;
    if (visiting.has(t)) throw new Error(`外部キーが循環している (${t})`);
    visiting.add(t);
    for (const p of [...parents.get(t)].sort()) visit(p);
    visiting.delete(t);
    done.add(t);
    order.push(t);
  };
  for (const t of [...tables].sort()) visit(t);
  return order;
}

/** 変換済みの行 (列の順の文字列か null の配列) を、引数の上限に収まる単位でまとめて入れる。 */
export async function insertRows(sql, table, columns, rows) {
  if (rows.length === 0) return;
  const identity = columns.some((c) => c.identity);
  const perRow = columns.length;
  const batch = Math.max(1, Math.floor(MAX_PARAMS / perRow));
  const head =
    `INSERT INTO ${quoteIdent(table)} (${columns.map((c) => quoteIdent(c.name)).join(', ')})` +
    (identity ? ' OVERRIDING SYSTEM VALUE' : '') +
    ' VALUES ';
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const params = [];
    const tuples = chunk.map((row) => {
      const slots = row.map((value, j) => {
        params.push(value);
        // いったん text で受けてから列の型へ変える。列の型 (jsonb / bool など) で受けると、postgres.js が
        // 引数の型に合わせて値を作り直す (文字列を JSON 文字列にする・'false' を真にする) ので、それを避ける。
        return `$${params.length}::text::${castFor(columns[j].udtName)}`;
      });
      return `(${slots.join(', ')})`;
    });
    await sql.unsafe(head + tuples.join(', '), params);
  }
}

/** serial (nextval 既定値) と identity の列の sequence を、入れた最大値へ合わせる。 */
export async function syncSequences(sql, table, schemaTable) {
  const synced = [];
  for (const [name, col] of Object.entries(schemaTable.columns)) {
    if (!col.serial && !col.identity) continue;
    const [{ seq }] = await sql`SELECT pg_get_serial_sequence(${quoteIdent(table)}, ${name}) AS seq`;
    if (!seq) continue;
    const [{ max }] = await sql.unsafe(`SELECT max(${quoteIdent(name)})::text AS max FROM ${quoteIdent(table)}`);
    if (max === null) continue; // 行が無い: sequence は初期のまま
    await sql`SELECT setval(${seq}::regclass, ${max}::bigint, true)`;
    synced.push({ column: name, value: max });
  }
  return synced;
}
