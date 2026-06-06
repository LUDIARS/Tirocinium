// ES プロファイル × 企業 の heuristic 適合スコア (0-100)。 純粋関数。
// LLM 不在 (dev / 鍵なし / 失敗) でも recommend を成立させる candidate 抽出と、
// LLM rerank に渡す candidate の事前絞り込みの両方に使う。

import type { ApplicantProfile, Company } from './types.js';
import { normalizeRoles } from './normalize.js';

/** 比較用に小文字化したトークン集合を作る (日本語はそのまま語として扱う)。 */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[\s,、。・/\\|()（）「」【】:：;；]+/)) {
    const t = raw.trim();
    if (t.length >= 2) out.add(t);
  }
  return out;
}

/** profile 側のキーワード集合 (esText + tags + targetCompany)。 */
export function profileKeywords(profile: ApplicantProfile): Set<string> {
  const kw = tokenize(profile.esText);
  for (const t of profile.tags) kw.add(t.toLowerCase());
  if (profile.targetCompany) kw.add(profile.targetCompany.toLowerCase());
  return kw;
}

export type ScoreBreakdown = {
  score: number;
  roleMatch: boolean;
  tagOverlap: string[];
  keywordHits: string[];
};

/**
 * 適合スコアを算出する。
 * - 職種一致: +35
 * - tag 重なり: 1 件 +12 (最大 36)
 * - ES キーワードが企業 description/tags/industry に出現: 1 件 +6 (最大 24)
 * - 志望企業名の一致: +5
 * 上限 100。
 */
export function scoreCompany(profile: ApplicantProfile, company: Company): ScoreBreakdown {
  const kw = profileKeywords(profile);
  const tagLower = profile.tags.map((t) => t.toLowerCase());

  const targetRoles = normalizeRoles(profile.targetRole ? [String(profile.targetRole)] : []);
  const roleMatch =
    targetRoles.length === 0
      ? false
      : company.roles.some((r) => targetRoles.includes(r));

  const tagOverlap = company.tags.filter((t) => tagLower.includes(t.toLowerCase()));

  const haystack = tokenize(
    [company.description, company.tags.join(' '), company.industry].join(' '),
  );
  const keywordHits = [...kw].filter((k) => haystack.has(k)).slice(0, 8);

  const companyNameMatch =
    !!profile.targetCompany &&
    company.name.toLowerCase().includes(profile.targetCompany.toLowerCase());

  let score = 0;
  if (roleMatch) score += 35;
  score += Math.min(tagOverlap.length * 12, 36);
  score += Math.min(keywordHits.length * 6, 24);
  if (companyNameMatch) score += 5;

  return { score: Math.min(100, score), roleMatch, tagOverlap, keywordHits };
}

/** 企業群を heuristic スコア降順に並べ、 上位 limit 件を返す (score>0 のみ)。 */
export function rankCandidates(
  profile: ApplicantProfile,
  companies: Company[],
  limit: number,
): { company: Company; breakdown: ScoreBreakdown }[] {
  return companies
    .map((company) => ({ company, breakdown: scoreCompany(profile, company) }))
    .filter((x) => x.breakdown.score > 0)
    .sort((a, b) => b.breakdown.score - a.breakdown.score)
    .slice(0, limit);
}
