// sessions.metadata (JSONB on PG / TEXT on SQLite) への安全なパッチ適用。
//
// 旧実装は `metadata = metadata || ${sql.json(patch)}` という PG jsonb の連結演算子に
// 依存していたが、 SQLite 側は metadata が TEXT 列のため `||` は「文字列連結」になり、
// 例えば `{"a":1}` || `{"b":2}` → `{"a":1}{"b":2}` という不正 JSON を生む。
// これを次回 SELECT + JSON.parse (asObject 相当) した際に init 処理がクラッシュしうる。
//
// JSON.parse → object マージ → JSON.stringify (sql.json) を介した経路に統一し、
// PG / SQLite 両方言で常に正しい JSON を書き戻す。

import { sql } from './index.js';

function asObject(v: unknown): Record<string, unknown> {
  const obj = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return obj && typeof obj === 'object' && !Array.isArray(obj)
    ? (obj as Record<string, unknown>)
    : {};
}

/**
 * sessions.metadata に patch を浅くマージして永続化する。
 * 読み→マージ→書きの 2 クエリ (完全な原子性は保証しないが、 文字列連結による JSON 破損は解消する)。
 */
export async function patchSessionMetadata(
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const rows = await sql<{ metadata: unknown }[]>`
    SELECT metadata FROM sessions WHERE id = ${sessionId}
  `;
  const merged = { ...asObject(rows[0]?.metadata), ...patch };
  await sql`
    UPDATE sessions SET metadata = ${sql.json(merged as never)}
    WHERE id = ${sessionId}
  `;
}
