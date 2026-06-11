// `postgres` ライブラリ風のタグ付きテンプレート `sql` を node:sqlite (DatabaseSync) 上で
// 再実装した互換ドライバ。 既存の 21 ファイルの呼び出し (sql`...` / ネスト fragment /
// sql.json / sql.unsafe / sql.begin / sql.end / RETURNING / ON CONFLICT) をそのまま動かす。
//
// 方言差は最小の textual normalize で吸収する (now()→datetime('now') / ::cast 除去 / FOR UPDATE 除去)。
// 構造的 PG-ism (xmax / int4range / ANY) は呼び出し側を dialect 分岐で対応する (db/index.ts の isSqlite)。
//
// 型は postgres の `Sql` に as-cast して公開するため (db/index.ts)、 本ファイルは any 中心。

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

/** sql.json(x) のマーカー: 値を JSON テキストとして 1 パラメータに束ねる。 */
class JsonParam {
  constructor(readonly value: unknown) {}
}

/** PG → SQLite の安全な方言正規化 (頻出・無曖昧なものだけ)。 */
function toSqliteDialect(text: string): string {
  return text
    .replace(/\bnow\(\)/gi, "datetime('now')")
    .replace(/::\s*(text|int|integer|bigint|jsonb|json|uuid|smallint)\b/gi, '')
    .replace(/\bFOR\s+UPDATE\b/gi, '')
    .replace(/\$(\d+)/g, '?$1'); // PG 位置パラメータ $N → SQLite ?N (sql.unsafe で使用)
}

/** 書込みパラメータを SQLite が受ける型へ寄せる (bool→0/1 / 配列・オブジェクト→JSON / Date→ISO)。 */
function encodeParam(v: unknown): string | number | bigint | null | Uint8Array {
  if (v === null || v === undefined) return null;
  if (v instanceof JsonParam) return JSON.stringify(v.value ?? null);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 読出し値の復号: JSON 配列/オブジェクトらしき TEXT は parse する (TEXT[] / JSONB 相当)。 */
function decodeValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trimStart();
  if (t === '' || (t[0] !== '[' && t[0] !== '{')) return v;
  try {
    const parsed = JSON.parse(v);
    return typeof parsed === 'object' ? parsed : v;
  } catch {
    return v;
  }
}

function decodeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) out[k] = decodeValue(row[k]);
  return out;
}

type Built = { text: string; params: unknown[] };

/** タグ付きテンプレート 1 個。 await でクエリ実行、 値としてネストすると fragment 展開される。 */
class SqliteQuery {
  constructor(
    private readonly db: DatabaseSync,
    private readonly strings: readonly string[],
    private readonly values: readonly unknown[],
  ) {}

  /** ネスト fragment を再帰展開して 1 本の {text, params} にする。 */
  build(): Built {
    let text = '';
    const params: unknown[] = [];
    for (let i = 0; i < this.strings.length; i++) {
      text += this.strings[i];
      if (i < this.values.length) {
        const v = this.values[i];
        if (v instanceof SqliteQuery) {
          const sub = v.build();
          text += sub.text;
          params.push(...sub.params);
        } else {
          text += '?';
          params.push(v);
        }
      }
    }
    return { text, params };
  }

  private exec(): unknown[] {
    const { text, params } = this.build();
    const sql = toSqliteDialect(text);
    const bound = params.map(encodeParam);
    const returnsRows = /^\s*(select|with|pragma)\b/i.test(sql) || /\breturning\b/i.test(sql);
    const stmt = this.db.prepare(sql);
    if (returnsRows) {
      return (stmt.all(...(bound as never[])) as Record<string, unknown>[]).map(decodeRow);
    }
    stmt.run(...(bound as never[]));
    return [];
  }

  // thenable: await sql`...` でクエリ実行 → rows[]
  then<T = unknown>(
    resolve: (rows: unknown[]) => T,
    reject?: (err: unknown) => unknown,
  ): T | undefined {
    try {
      return resolve(this.exec());
    } catch (err) {
      if (reject) return reject(err) as T;
      throw err;
    }
  }
  catch(reject: (err: unknown) => unknown): unknown {
    try {
      return Promise.resolve(this.exec());
    } catch (err) {
      return reject(err);
    }
  }
}

export type SqliteSql = ((strings: TemplateStringsArray, ...values: unknown[]) => SqliteQuery) & {
  json(v: unknown): JsonParam;
  unsafe(text: string, params?: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (tx: SqliteSql) => Promise<T>): Promise<T>;
  end(): Promise<void>;
};

/** node:sqlite を開いて postgres 風 `sql` を返す。 */
export function createSqliteSql(path: string): SqliteSql {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  // PG の uuid_generate_v4() を移植 (migration の DEFAULT で使う)。非決定的なので行ごとに新規生成。
  db.function('uuid_generate_v4', { deterministic: false }, () => randomUUID());
  db.function('gen_random_uuid', { deterministic: false }, () => randomUUID());
  // PG の cardinality(配列) を移植。 SQLite では配列は JSON テキストなので length を返す。
  db.function('cardinality', { deterministic: true }, (json: unknown) => {
    if (typeof json !== 'string') return 0;
    try {
      const a = JSON.parse(json);
      return Array.isArray(a) ? a.length : 0;
    } catch {
      return 0;
    }
  });

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    new SqliteQuery(db, strings, values)) as SqliteSql;

  sql.json = (v: unknown) => new JsonParam(v);

  sql.unsafe = async (text: string, params: unknown[] = []) => {
    const normalized = toSqliteDialect(text);
    if (params.length > 0 || /^\s*(select|with|pragma)\b/i.test(normalized) || /\breturning\b/i.test(normalized)) {
      const stmt = db.prepare(normalized);
      const bound = params.map(encodeParam);
      return (stmt.all(...(bound as never[])) as Record<string, unknown>[]).map(decodeRow);
    }
    db.exec(normalized); // 複文 DDL (migration 等)
    return [];
  };

  sql.begin = async <T>(fn: (tx: SqliteSql) => Promise<T>): Promise<T> => {
    db.exec('BEGIN');
    try {
      const result = await fn(sql);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  sql.end = async () => {
    db.close();
  };

  return sql;
}
