// 面接ブリーフ (Interview Brief) のコンパイル。
// spec/feature/inference/interviewer-reproduction.md §5 (Discutere discussion_paper の面接版):
// セッション前にコンパイルし、セッション中は不変。md 見出しは固定。
// 質問候補 (candidates) は source_meta に snapshot し、再接続時に
// 「同じ seed + 同じ候補 = 同じプラン」で決定的に再コンパイルできるようにする。

import type { PlanBrief, QuestionCandidate } from '@tirocinium/llm';
import { canonicalRole } from '@tirocinium/llm';
import { loadQaSeed } from './qa-seed-loader.js';
import {
  getCompanyQuestions,
  getNewgradImage,
  getObPatterns,
  newgradThemeCandidates,
  resolveCompany,
} from './sources.js';
import { assessSufficiency, type SufficiencyResult } from './sufficiency-gate.js';

export type BriefBuildInput = {
  stage: string;
  targetCompany: string | null;
  targetRole: string | null;
  /** 面接官ペルソナの md ブロック (buildInterviewerPromptBlock の出力) */
  personaBlock: string;
  weakTop3: string[];
  /** Memoria RAG 抜粋 (renderRagBlock の出力。無ければ '') */
  ragBlock: string;
  seed: number;
};

export type BuiltBrief = {
  bodyMd: string;
  /** 監査 + 再現の入力 snapshot。interview_briefs.source_meta に永続化する */
  sourceMeta: Record<string, unknown>;
  planBrief: PlanBrief;
  sufficiency: SufficiencyResult;
};

function section(title: string, body: string): string {
  return `# ${title}\n\n${body.trim() || '(情報なし)'}\n`;
}

function renderQuestionLines(candidates: QuestionCandidate[]): string {
  return candidates
    .map((c) => `- [${c.origin}] ${c.theme}: ${c.question}`)
    .join('\n');
}

/** ブリーフをコンパイルする。DB / ファイル読み出しはここに集約 (面接中は再取得しない)。 */
export async function buildInterviewBrief(input: BriefBuildInput): Promise<BuiltBrief> {
  const role = canonicalRole(input.targetRole);
  const company = await resolveCompany(input.targetCompany);

  const newgrad = company ? await getNewgradImage(company.id, role) : null;
  const companyQs = company ? await getCompanyQuestions(company.id, input.stage, role) : [];
  const obPs = company ? await getObPatterns(company.id, input.stage, role) : [];

  const sufficiency = assessSufficiency({
    companyResolved: company != null,
    hasNewgradImage: newgrad != null,
    companyQuestionCount: companyQs.length,
    obPatternCount: obPs.length,
  });

  const qaSeed = await loadQaSeed(input.stage, role);

  const candidates: QuestionCandidate[] = [
    ...companyQs.map(({ sourceId: _sourceId, ...c }) => c),
    ...obPs.map(({ sourceId: _sourceId, ...c }) => c),
    ...newgradThemeCandidates(newgrad?.themes ?? []),
    ...qaSeed.items,
  ];

  const planBrief: PlanBrief = {
    stage: input.stage,
    role,
    companyName: company?.name ?? input.targetCompany,
    candidates,
  };

  const bodyMd = [
    section(
      '企業と職種',
      [
        `- 志望企業: ${company?.name ?? input.targetCompany ?? '(指定なし)'}${company ? '' : ' (企業 DB 未解決)'}`,
        `- 職種: ${input.targetRole ?? '(指定なし)'} (正規化: ${role})`,
        `- 面接ステージ: ${input.stage}`,
        `- 充足判定: ${sufficiency.level} — ${sufficiency.reason}`,
      ].join('\n'),
    ),
    section(
      '求める新卒像',
      newgrad
        ? `${newgrad.summary}\n\nテーマ: ${newgrad.themes.join(' / ') || '(なし)'}`
        : '(企業固有データなし)',
    ),
    section(
      '過去の質問傾向',
      renderQuestionLines([...companyQs, ...obPs]) ||
        `(企業固有の質問プールなし — 一般解シード${qaSeed.fallbackRole ? ` [${qaSeed.fallbackRole} へ退避]` : ''} で実施)`,
    ),
    section('受験者の素材', input.ragBlock),
    section('面接官ペルソナ', input.personaBlock),
    section('今回の重点', input.weakTop3.length ? `弱点軸: ${input.weakTop3.join(', ')}` : '(弱点プロファイルなし)'),
  ].join('\n');

  const sourceMeta = {
    company_id: company?.id ?? null,
    newgrad_role: newgrad?.role ?? null,
    company_question_ids: companyQs.map((c) => c.sourceId),
    ob_pattern_ids: obPs.map((c) => c.sourceId),
    qa_seed: { stage: input.stage, role, fallback_role: qaSeed.fallbackRole },
    sufficiency: sufficiency.level,
    sufficiency_reason: sufficiency.reason,
    snapshot_at: new Date().toISOString(),
    // 再接続時の決定的プラン再コンパイル用 snapshot (同 seed + 同候補 = 同プラン)
    candidates,
    plan: { stage: input.stage, role, company_name: planBrief.companyName },
  };

  return { bodyMd, sourceMeta, planBrief, sufficiency };
}

/** 永続化済み source_meta から PlanBrief を復元する (再接続経路)。 */
export function planBriefFromSourceMeta(sourceMeta: Record<string, unknown>): PlanBrief | null {
  const plan = sourceMeta['plan'] as { stage?: string; role?: string; company_name?: string | null } | undefined;
  const candidates = sourceMeta['candidates'];
  if (!plan || !Array.isArray(candidates)) return null;
  return {
    stage: plan.stage ?? '',
    role: plan.role ?? null,
    companyName: plan.company_name ?? null,
    candidates: candidates as QuestionCandidate[],
  };
}
