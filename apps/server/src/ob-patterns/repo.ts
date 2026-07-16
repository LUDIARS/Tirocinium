// ob_question_patterns の永続化 (migration 024)。
// 重複は (company_id, theme, question_pattern) で畳み込み、source_refs をマージする。
// 回答本文は持たない (spec §6.2 — 質問の型のみ)。

import { sql } from '../db/index.js';

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
  /** OB#xxxx (ob-alias.ts の出力のみを渡すこと) */
  contributorAlias: string;
};

export type UpsertResult = { id: string; deduped: boolean };

function asStringArray(v: unknown): string[] {
  const arr = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === 'string');
}

export async function upsertObPattern(input: ObPatternInput): Promise<UpsertResult> {
  const existing = await sql<{ id: string; source_refs: unknown }[]>`
    SELECT id, source_refs FROM ob_question_patterns
    WHERE company_id = ${input.companyId}
      AND theme = ${input.theme}
      AND question_pattern = ${input.questionPattern}
    LIMIT 1
  `;
  const row = existing[0];
  if (row) {
    // 既存パターン: 出所参照だけマージ (内容は最初の抽出を正とする)
    const refs = [...new Set([...asStringArray(row.source_refs), ...input.sourceRefs])];
    await sql`
      UPDATE ob_question_patterns SET source_refs = ${sql.json(refs as never)}
      WHERE id = ${row.id}
    `;
    return { id: row.id, deduped: true };
  }
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO ob_question_patterns
      (company_id, stage, role, theme, question_pattern, followup_patterns, axes, source_refs, contributor_alias)
    VALUES (
      ${input.companyId}, ${input.stage}, ${input.role}, ${input.theme}, ${input.questionPattern},
      ${sql.json(input.followupPatterns as never)}, ${sql.json(input.axes as never)},
      ${sql.json(input.sourceRefs as never)}, ${input.contributorAlias}
    )
    RETURNING id
  `;
  return { id: inserted[0]!.id, deduped: false };
}

export async function countObPatterns(companyId: string): Promise<number> {
  const rows = await sql<{ n: number | string }[]>`
    SELECT COUNT(*) AS n FROM ob_question_patterns WHERE company_id = ${companyId}
  `;
  return Number(rows[0]?.n ?? 0);
}
