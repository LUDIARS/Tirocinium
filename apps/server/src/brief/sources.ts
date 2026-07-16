// 面接ブリーフの学習データ供給源 (DB 取得層)。
// spec/feature/inference/interviewer-reproduction.md §6:
// 企業が求める新卒像 / 企業別質問プール / OB 質問パターン を Tr の DB から引く。
// 生の ES / トランスクリプトはここでは扱わない (Memoria RAG は runtime 側の ragBlock)。

import { normalizeName } from '@tirocinium/companies';
import { AXIS_KEYS, type AxisKey, type QuestionCandidate } from '@tirocinium/llm';
import { sql } from '../db/index.js';

export type CompanyRef = { id: string; name: string; url: string };

/** JSONB (PG) / TEXT (SQLite) 両対応の配列読出し。 */
function asStringArray(v: unknown): string[] {
  const arr = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === 'string');
}

function asAxes(v: unknown): AxisKey[] {
  return asStringArray(v).filter((a): a is AxisKey => (AXIS_KEYS as string[]).includes(a));
}

/** target_company (自由入力の社名) を companies 行へ解決する。別名照合は normalized_name。 */
export async function resolveCompany(targetCompany: string | null): Promise<CompanyRef | null> {
  if (!targetCompany || !targetCompany.trim()) return null;
  const normalized = normalizeName(targetCompany);
  const rows = await sql<CompanyRef[]>`
    SELECT id, name, url FROM companies
    WHERE normalized_name = ${normalized} OR name = ${targetCompany.trim()}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export type NewgradImage = { role: string; summary: string; themes: string[] };

/** 求める新卒像。role 粒度 → general → 会社全体像 (005) の順で引く。 */
export async function getNewgradImage(
  companyId: string,
  role: string,
): Promise<NewgradImage | null> {
  const roleRows = await sql<{ role: string; summary: string; themes: unknown }[]>`
    SELECT role, summary, themes FROM company_newgrad_role_images
    WHERE company_id = ${companyId} AND role IN (${role}, 'general')
    ORDER BY CASE WHEN role = ${role} THEN 0 ELSE 1 END
    LIMIT 1
  `;
  const r = roleRows[0];
  if (r && r.summary.trim()) {
    return { role: r.role, summary: r.summary, themes: asStringArray(r.themes) };
  }
  const compRows = await sql<{ summary: string; themes: unknown }[]>`
    SELECT summary, themes FROM company_newgrad_images WHERE company_id = ${companyId}
  `;
  const c = compRows[0];
  if (c && c.summary.trim()) {
    return { role: 'general', summary: c.summary, themes: asStringArray(c.themes) };
  }
  return null;
}

export type SourcedCandidate = QuestionCandidate & {
  sourceId: string;
  /** OB 由来のみ: 仮名化済み投稿者 (OB#xxxx)。生 ID はここに来ない */
  contributorAlias?: string;
};

/** 企業別質問プール (最優先供給源)。stage/role は '' / 'general' を共通枠として含める。 */
export async function getCompanyQuestions(
  companyId: string,
  stage: string,
  role: string,
): Promise<SourcedCandidate[]> {
  const rows = await sql<
    { id: string; theme: string; question: string; followups: unknown; axes: unknown }[]
  >`
    SELECT id, theme, question, followups, axes FROM company_interview_questions
    WHERE company_id = ${companyId}
      AND stage IN (${stage}, '')
      AND role IN (${role}, 'general')
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map((r) => ({
    sourceId: r.id,
    theme: r.theme.trim() || '企業質問',
    question: r.question,
    followups: asStringArray(r.followups),
    axes: asAxes(r.axes),
    origin: 'company' as const,
  }));
}

/** OB コーパス由来の質問パターン (質問の型のみ / 個人情報なし)。 */
export async function getObPatterns(
  companyId: string,
  stage: string,
  role: string,
): Promise<SourcedCandidate[]> {
  const rows = await sql<
    { id: string; theme: string; question_pattern: string; followup_patterns: unknown; axes: unknown; contributor_alias: string }[]
  >`
    SELECT id, theme, question_pattern, followup_patterns, axes, contributor_alias
    FROM ob_question_patterns
    WHERE company_id = ${companyId}
      AND stage IN (${stage}, '')
      AND role IN (${role}, 'general')
    ORDER BY created_at ASC, id ASC
  `;
  return rows.map((r) => ({
    sourceId: r.id,
    theme: r.theme.trim() || 'OB 質問パターン',
    question: r.question_pattern,
    followups: asStringArray(r.followup_patterns),
    axes: asAxes(r.axes),
    origin: 'ob' as const,
    contributorAlias: r.contributor_alias || undefined,
  }));
}

/** 新卒像 themes から質問候補を導出する (供給源 3 位)。決定的なテンプレート整形のみ。 */
export function newgradThemeCandidates(themes: string[]): QuestionCandidate[] {
  return themes
    .filter((t) => t.trim().length > 0)
    .map((theme) => ({
      theme: theme.trim(),
      question: `当社が大切にしている「${theme.trim()}」について、あなた自身の経験を交えて考えを聞かせてください。`,
      followups: [`その経験の中で、あなた個人の担当と判断は何でしたか。`],
      axes: ['target_fit', 'self_understanding'] as AxisKey[],
      origin: 'newgrad' as const,
    }));
}
