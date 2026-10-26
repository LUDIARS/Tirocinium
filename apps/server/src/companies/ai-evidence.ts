import { htmlToText } from '@tirocinium/companies';

export const AI_DIMENSIONS = ['policy', 'hiring', 'trials', 'deployment', 'effects', 'investment'] as const;
export type AiDimension = typeof AI_DIMENSIONS[number];
export type AiEvidence = { url: string; title: string; fetchedAt: string; publishedAt: string | null;
  excerpt: string; dimensions: AiDimension[]; interpretation: 'quoted_mention_only' };
const AI = /\bAI\b|人工知能|生成\s*AI|機械学習|machine learning|artificial intelligence/i;
const MARKERS: Record<AiDimension, RegExp> = {
  policy: /方針|戦略|strategy|policy/i, hiring: /採用|求人|募集|recruit|hiring/i,
  trials: /検証|実証|試験|trial|pilot/i, deployment: /導入|活用|利用|deploy|adopt/i,
  effects: /効果|生産性|効率|productivity|efficien/i, investment: /投資|予算|研究費|invest|budget/i,
};

/** Restricts documents and final redirect destinations to the company's own site. */
export function isOfficialSite(url: string, companyUrl: string): boolean {
  try {
    const u = new URL(url), root = new URL(companyUrl);
    const host = root.hostname.toLowerCase().replace(/^www\./, '');
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password
      && (u.hostname.toLowerCase() === host || u.hostname.toLowerCase().endsWith(`.${host}`))
      && !u.hash && u.href.length <= 2000;
  } catch { return false; }
}

/** Preserve contextual negative statements; markers are NOT adoption assertions. */
export function extractAiEvidence(html: string, url: string, fetchedAt: string): AiEvidence[] {
  const title = (html.match(/<title[^>]*>([^<]{0,300})<\/title>/i)?.[1] ?? '').trim();
  // Only explicitly labelled publication dates; arbitrary years are not publication dates.
  const rawDate = html.match(/(?:article:published_time|datePublished)["'\s:= content]+(\d{4}-\d{2}-\d{2}(?:T[^"'<>\s]+)?)/i)?.[1];
  const publishedAt = rawDate && Number.isFinite(Date.parse(rawDate)) ? rawDate : null;
  const text = htmlToText(html, 32_000);
  const excerpts: string[] = [];
  // Bounded context retains both prohibitions and supported usage from the same paragraph.
  const matcher = new RegExp(AI.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) && excerpts.length < 6) {
    const excerpt = text.slice(Math.max(0, match.index - 200), Math.min(text.length, match.index + 1000)).trim();
    if (!excerpts.some(previous => previous.includes(excerpt) || excerpt.includes(previous))) excerpts.push(excerpt);
  }
  return excerpts.map(excerpt => ({ url, title, fetchedAt, publishedAt, excerpt,
    dimensions: AI_DIMENSIONS.filter(d => MARKERS[d].test(excerpt)), interpretation: 'quoted_mention_only' }));
}
