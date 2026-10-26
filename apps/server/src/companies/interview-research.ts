import { extractAnchors } from '@tirocinium/companies';
import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { extractAiEvidence, isOfficialSite, type AiEvidence } from './ai-evidence.js';

export type AiResearch = { status: 'mentions_found' | 'not_found_in_scope' | 'unavailable'; checkedAt: string;
  evidence: AiEvidence[]; failures: { url: string; reason: string }[]; checkedUrls: string[]; scope: string };
const MAX_PAGES = 5;
const MAX_BODY = 256 * 1024;
const LINK = /AI|人工知能|機械学習|strategy|ir\/|seminar|research|technology|採用|recruit|career/i;

/** Bounded official-only research. No service startup, external search or LLM extraction. */
export async function researchCompanyAi(companyUrl: string, profileUrls: string[], now: () => Date = () => new Date()): Promise<AiResearch> {
  const checkedAt = now().toISOString();
  const result: AiResearch = { status: 'unavailable', checkedAt, evidence: [], failures: [], checkedUrls: [],
    scope: 'Official company hostname/subdomains only; max 5 pages, 256KiB/page, 3s/request, 8s overall network/robots/throttle deadline. External recruitment hosts/PDF not covered. Keyword mentions are not verified company policy/adoption. Missing evidence is not low commitment.' };
  if (!isOfficialSite(companyUrl, companyUrl)) return result;
  const fetcher = new PoliteFetcher({ userAgent: config.companyCrawl.userAgent, fetchTimeoutMs: 3000,
    minIntervalMs: config.companyCrawl.minIntervalMs, respectRobots: true, maxResponseBytes: MAX_BODY });
  const queue = [...new Set([...profileUrls.filter(u => isOfficialSite(u, companyUrl)), companyUrl])].slice(0, MAX_PAGES);
  const seen = new Set<string>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
  while (queue.length && seen.size < MAX_PAGES && !controller.signal.aborted) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const fetched = await fetcher.fetch(url, controller.signal);
    if (!fetched.ok) { result.failures.push({ url, reason: fetched.reason }); continue; }
    const finalUrl = fetched.finalUrl ?? url;
    if (!isOfficialSite(finalUrl, companyUrl)) { result.failures.push({ url, reason: 'external_redirect' }); continue; }
    const fetchedAt = now().toISOString(); result.checkedUrls.push(finalUrl);
    result.evidence.push(...extractAiEvidence(fetched.html, finalUrl, fetchedAt));
    // Existing link_cache is a plain-text consumer contract. Do not store raw
    // HTML there. The bounded public research result is snapshotted in the brief.
    for (const anchor of extractAnchors(fetched.html).filter(a => LINK.test(`${a.href} ${a.text}`)).slice(0, 30)) {
      try {
        const next = new URL(anchor.href, finalUrl); next.hash = '';
        if (isOfficialSite(next.href, companyUrl) && !seen.has(next.href) && !queue.includes(next.href)) queue.push(next.href);
      } catch { /* Malformed public anchor is not a usable research source. */ }
    }
  }
  if (controller.signal.aborted) result.failures.push({ url: companyUrl, reason: 'research_deadline' });
  } finally { clearTimeout(timer); }
  if (queue.length) result.failures.push({ url: companyUrl, reason: 'scope_page_or_time_limit' });
  if (result.evidence.length > 6) result.failures.push({ url: companyUrl, reason: 'snapshot_excerpt_limit' });
  result.evidence = result.evidence.slice(0, 6);
  result.status = result.evidence.length ? 'mentions_found' : result.checkedUrls.length ? 'not_found_in_scope' : 'unavailable';
  return result;
}
