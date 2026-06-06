// enrichment: 企業サイトを巡回し IR / 企業理念 / 会社概要 を抽出して company_profiles へ。
// companies の url を起点に、 同一ホストの理念/IR/about/recruit リンクを辿る (robots 遵守)。

import { createAnthropicClient, MODEL } from '@tirocinium/llm';
import {
  selectEnrichmentLinks,
  enrichmentFetchList,
  extractProfile,
  htmlToText,
  type Company,
} from '@tirocinium/companies';
import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { companiesNeedingEnrichment, getCompany } from './repo.js';
import { upsertProfile } from './profile-repo.js';

export type EnrichSummary = {
  targets: number;
  enriched: number;
  skipped: number;
  pagesFetched: number;
  robotsBlocked: number;
  errors: { company: string; message: string }[];
};

/** enrichment を実行する。 companyId 指定で 1 社、 無指定なら未取得を limit 件。 */
export async function runEnrichment(opts: { companyId?: string; limit?: number } = {}): Promise<EnrichSummary> {
  const summary: EnrichSummary = {
    targets: 0,
    enriched: 0,
    skipped: 0,
    pagesFetched: 0,
    robotsBlocked: 0,
    errors: [],
  };

  if (config.llmBackend !== 'api' || !process.env['ANTHROPIC_API_KEY']) {
    throw new Error('enrichment は LLM 抽出が必須です (ANTHROPIC_API_KEY + api backend)');
  }

  let targets: Company[];
  if (opts.companyId) {
    const c = await getCompany(opts.companyId);
    targets = c && c.url ? [c] : [];
  } else {
    targets = await companiesNeedingEnrichment(opts.limit ?? 20);
  }
  summary.targets = targets.length;
  if (targets.length === 0) return summary;

  const client = createAnthropicClient();
  const fetcher = new PoliteFetcher({
    userAgent: config.companyCrawl.userAgent,
    fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
    minIntervalMs: config.companyCrawl.minIntervalMs,
    respectRobots: config.companyCrawl.respectRobots,
  });

  for (const company of targets) {
    try {
      const enriched = await enrichOne(client, fetcher, company, summary);
      if (enriched) summary.enriched++;
      else summary.skipped++;
    } catch (err) {
      summary.errors.push({ company: company.name, message: (err as Error).message });
    }
  }

  console.log(
    `[companies] enrich targets=${summary.targets} enriched=${summary.enriched} ` +
      `skipped=${summary.skipped} pages=${summary.pagesFetched} errors=${summary.errors.length}`,
  );
  return summary;
}

async function enrichOne(
  client: ReturnType<typeof createAnthropicClient>,
  fetcher: PoliteFetcher,
  company: Company,
  summary: EnrichSummary,
): Promise<boolean> {
  const home = await fetcher.fetch(company.url);
  if (!home.ok) {
    if (home.reason === 'robots') summary.robotsBlocked++;
    return false;
  }
  summary.pagesFetched++;

  const links = selectEnrichmentLinks(company.url, home.html);
  const pages = enrichmentFetchList(links, config.companyCrawl.enrichMaxPages);

  // 巡回ページ本文を集める (理念 / IR / about / recruit)。 ホーム本文も材料に含める。
  const sections: string[] = [`# ${company.name} (home)\n${htmlToText(home.html, 4000)}`];
  const fetchedUrls: string[] = [company.url];
  for (const u of pages) {
    const res = await fetcher.fetch(u);
    if (!res.ok) {
      if (res.reason === 'robots') summary.robotsBlocked++;
      continue;
    }
    summary.pagesFetched++;
    sections.push(`# ${u}\n${htmlToText(res.html, 4000)}`);
    fetchedUrls.push(u);
  }

  const profile = await extractProfile(client, MODEL.EXTRACTOR, sections.join('\n\n---\n\n'));
  // 何も取れなければ skip 扱い (空 profile を保存しない)
  if (!profile.philosophy && !profile.ir_summary && !profile.business && (profile.values?.length ?? 0) === 0) {
    return false;
  }
  await upsertProfile(company.id, { ...profile, sources: fetchedUrls });
  return true;
}
