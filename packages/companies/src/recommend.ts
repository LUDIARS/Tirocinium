// ES プロファイル × candidate 企業 → おすすめ ranking。
// LLM rerank (recommend) と heuristic-only (recommendHeuristic) の 2 系統。
// LLM 呼び出し以外は純粋関数。

import type Anthropic from '@anthropic-ai/sdk';
import { extractText, extractJsonBlock } from '@tirocinium/llm';
import type {
  ApplicantProfile,
  Company,
  RecommendationItem,
  RecommendationResult,
} from './types.js';
import { rankCandidates, type ScoreBreakdown } from './score.js';

export const RECOMMEND_INSTRUCTION = `
あなたは就活アドバイザーです。 受験者の ES 要約と、 候補企業リストを渡します。
受験者に合うおすすめ企業を上位から並べ、 JSON で返してください。

出力は **JSON オブジェクト 1 個のみ**。前置き・コードフェンス以外の説明は禁止。
スキーマ:
{
  "items": [
    {
      "company_id": "渡された候補の id をそのまま",
      "score": 0-100 の適合度 (整数),
      "reasons": ["なぜ合うか (2-3 個、各 1 文)"],
      "concerns": ["ミスマッチ・確認すべき点 (0-2 個)"]
    }
  ]
}

ルール:
- **候補リストに無い企業は出さない** (company_id は必ず候補のもの)。
- reasons は ES の内容と企業の特徴を結びつけて述べる。 ES 本文を逐語コピーしない。
- 合わない候補は items から外してよい。 無理に全件返さない。
- score 降順で並べる。
`.trim();

/** 候補を LLM に渡す Markdown に整形する。 */
export function renderCandidates(
  candidates: { company: Company; breakdown: ScoreBreakdown }[],
): string {
  return candidates
    .map(({ company: c }) => {
      const parts = [
        `id: ${c.id}`,
        `名前: ${c.name}`,
        c.industry && `業界: ${c.industry}`,
        c.roles.length > 0 && `募集職種: ${c.roles.join(', ')}`,
        c.tags.length > 0 && `タグ: ${c.tags.join(', ')}`,
        c.location && `所在地: ${c.location}`,
        c.size && `規模: ${c.size}`,
        c.description && `概要: ${c.description}`,
      ].filter(Boolean);
      return `- ${parts.join(' / ')}`;
    })
    .join('\n');
}

/** profile を LLM に渡す Markdown に整形する。 */
export function renderProfile(profile: ApplicantProfile): string {
  const lines = ['## 受験者プロファイル'];
  if (profile.targetRole) lines.push(`志望職種: ${profile.targetRole}`);
  if (profile.targetCompany) lines.push(`志望企業/業界: ${profile.targetCompany}`);
  if (profile.tags.length > 0) lines.push(`興味タグ: ${profile.tags.join(', ')}`);
  if (profile.weakAxes && profile.weakAxes.length > 0)
    lines.push(`鍛えたい弱点軸: ${profile.weakAxes.join(', ')}`);
  lines.push('', '## ES / ポートフォリオ要約', profile.esText.slice(0, 4000));
  return lines.join('\n');
}

/** LLM 出力テキストを RecommendationItem[] に parse する。 id は候補集合で検証。 */
export function parseRecommendation(text: string, validIds: Set<string>): RecommendationItem[] {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as { items?: unknown };
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const out: RecommendationItem[] = [];
  for (const raw of rawItems) {
    const r = raw as Record<string, unknown>;
    const id = typeof r['company_id'] === 'string' ? r['company_id'] : '';
    if (!validIds.has(id)) continue; // 幻覚 id を弾く
    const score = Number(r['score']);
    out.push({
      company_id: id,
      name: '', // 呼び出し側で candidate から補完
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
      reasons: strArr(r['reasons']).slice(0, 4),
      concerns: strArr(r['concerns']).slice(0, 3),
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

export type RecommendOptions = {
  /** LLM rerank 前の candidate 上限 (既定 30) */
  maxCandidates?: number;
  /** 最終返却件数 (既定 8) */
  topK?: number;
};

/** heuristic スコアのみで recommend を組み立てる (LLM 不在時)。 */
export function recommendHeuristic(
  profile: ApplicantProfile,
  companies: Company[],
  opts: RecommendOptions = {},
): RecommendationResult {
  const topK = opts.topK ?? 8;
  const ranked = rankCandidates(profile, companies, topK);
  const items: RecommendationItem[] = ranked.map(({ company, breakdown }) => ({
    company_id: company.id,
    name: company.name,
    score: breakdown.score,
    reasons: buildHeuristicReasons(breakdown),
    concerns: breakdown.roleMatch ? [] : ['志望職種の募集有無を要確認'],
  }));
  return { method: 'heuristic', model: 'none', items };
}

function buildHeuristicReasons(b: ScoreBreakdown): string[] {
  const reasons: string[] = [];
  if (b.roleMatch) reasons.push('志望職種の募集と一致');
  if (b.tagOverlap.length > 0) reasons.push(`共通キーワード: ${b.tagOverlap.join(', ')}`);
  if (b.keywordHits.length > 0) reasons.push(`ES と関連: ${b.keywordHits.slice(0, 4).join(', ')}`);
  if (reasons.length === 0) reasons.push('プロフィールと部分的に一致');
  return reasons;
}

/**
 * LLM rerank で recommend を組み立てる。
 * candidate は heuristic で事前に絞り込み (maxCandidates)、 LLM が最終 ranking + 理由づけを担う。
 */
export async function recommend(
  client: Anthropic,
  model: string,
  profile: ApplicantProfile,
  companies: Company[],
  opts: RecommendOptions = {},
): Promise<RecommendationResult> {
  const maxCandidates = opts.maxCandidates ?? 30;
  const topK = opts.topK ?? 8;
  const candidates = rankCandidates(profile, companies, maxCandidates);
  if (candidates.length === 0) {
    return { method: 'llm', model, items: [] };
  }

  const byId = new Map(candidates.map((c) => [c.company.id, c.company]));
  const validIds = new Set(byId.keys());

  const body = [renderProfile(profile), '', '## 候補企業', renderCandidates(candidates)].join('\n');
  const res = await client.messages.create({
    model,
    max_tokens: 2048,
    system: RECOMMEND_INSTRUCTION,
    messages: [{ role: 'user', content: body }],
  });

  const items = parseRecommendation(extractText(res.content), validIds)
    .map((it) => ({ ...it, name: byId.get(it.company_id)?.name ?? it.name }))
    .slice(0, topK);

  return { method: 'llm', model, items };
}
