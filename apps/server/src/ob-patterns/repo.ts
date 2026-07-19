// ob_question_patterns の永続化 (migration 024 + 025)。
// 重複は (company_id, theme, question_pattern) で畳み込み、source_refs / contributor_aliases を
// マージする。回答本文は持たない (spec §6.2 — 質問の型のみ)。
//
// upsert は「SELECT → 無ければ INSERT / あれば UPDATE」を 1 トランザクション内で行う。
// 同一パターンへの並行 upsert が競合した場合、migration 025 の UNIQUE 制約
// (uq_obqp_dedup) が最終防波堤となり、INSERT が unique violation で落ちる —
// その場合は関数全体をやり直す (新しいトランザクションで SELECT すれば、
// 先に commit した側の行が見えるので通常の UPDATE 経路に合流する)。

import { isSqlite, sql } from '../db/index.js';

export type ObPatternInput = {
  companyId: string;
  stage: string;
  role: string;
  theme: string;
  questionPattern: string;
  followupPatterns: string[];
  axes: string[];
  /** Memoria URI 等の出所参照 */
  sourceRefs: string[];
  /** OB#xxxx (ob-alias.ts の出力のみを渡すこと)。同一パターンに複数 OB が寄与すれば蓄積される。 */
  contributorAlias: string;
};

export type UpsertResult = { id: string; deduped: boolean };

function asStringArray(v: unknown): string[] {
  const arr = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === 'string');
}

/** postgres (23505) / node:sqlite (UNIQUE constraint failed) の一意制約違反を判定する。 */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null | undefined;
  if (!e) return false;
  if (e.code === '23505') return true;
  return /unique constraint/i.test(e.message ?? '');
}

async function upsertObPatternOnce(input: ObPatternInput): Promise<UpsertResult> {
  return sql.begin(async (tx) => {
    // PG のみ行ロック (SQLite は dialect 正規化で FOR UPDATE が除去される — 単一
    // コネクションの node:sqlite には元々並行トランザクションが無いため不要)。
    const lockClause = isSqlite ? sql`` : sql`FOR UPDATE`;
    const existing = await tx<{ id: string; source_refs: unknown; contributor_aliases: unknown }[]>`
      SELECT id, source_refs, contributor_aliases FROM ob_question_patterns
      WHERE company_id = ${input.companyId}
        AND theme = ${input.theme}
        AND question_pattern = ${input.questionPattern}
      LIMIT 1
      ${lockClause}
    `;
    const row = existing[0];
    if (row) {
      // 既存パターン: 出所参照 + 寄与 OB 別名をマージ (内容は最初の抽出を正とする)
      const refs = [...new Set([...asStringArray(row.source_refs), ...input.sourceRefs])];
      const aliases = [...new Set([...asStringArray(row.contributor_aliases), input.contributorAlias])];
      await tx`
        UPDATE ob_question_patterns
        SET source_refs = ${tx.json(refs as never)}, contributor_aliases = ${tx.json(aliases as never)}
        WHERE id = ${row.id}
      `;
      return { id: row.id, deduped: true };
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO ob_question_patterns
        (company_id, stage, role, theme, question_pattern, followup_patterns, axes, source_refs, contributor_aliases)
      VALUES (
        ${input.companyId}, ${input.stage}, ${input.role}, ${input.theme}, ${input.questionPattern},
        ${tx.json(input.followupPatterns as never)}, ${tx.json(input.axes as never)},
        ${tx.json(input.sourceRefs as never)}, ${tx.json([input.contributorAlias] as never)}
      )
      RETURNING id
    `;
    return { id: inserted[0]!.id, deduped: false };
  });
}

/** 原子的 upsert。 (company_id, theme, question_pattern) が既存なら source_refs /
 *  contributor_aliases をマージし、無ければ新規 insert する。並行実行時に unique 制約と
 *  衝突したら (先着に負けたら) 1 回だけやり直す。 */
export async function upsertObPattern(input: ObPatternInput): Promise<UpsertResult> {
  try {
    return await upsertObPatternOnce(input);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return upsertObPatternOnce(input);
  }
}

export async function countObPatterns(companyId: string): Promise<number> {
  const rows = await sql<{ n: number | string }[]>`
    SELECT COUNT(*) AS n FROM ob_question_patterns WHERE company_id = ${companyId}
  `;
  return Number(rows[0]?.n ?? 0);
}
