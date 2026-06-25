// 子クローラ連鎖の本体 (フルチェーン)。 crawl-queue が企業を upsert した後、 その企業を深掘りする:
//   1) サイト発見 (site-discover) → works / career / about URL
//   2) ゲーム紐付け + 企業情報: contribute (works + about、 cli LLM)
//   3) recruit-page 求人: career URL をアドホック recruit-page ソースにして全求人を抽出
// LLM は cli backend (claude -p) 前提 (CLI 子プロセスから呼ばれる)。 Web 本体は spawn するだけ。

import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { getCompany } from './repo.js';
import { runContribute } from './contribute.js';
import { runJobNewsCrawl } from './job-news-crawler.js';
import { discoverSite } from './site-discover.js';
import type { NewsSourceConfig } from './news-config.js';

export type EnrichChainSummary = {
  companyId: string;
  companyName: string;
  discovered: { works: number; career: number; about: number };
  contribute: { processed: number; applied: number; games: number } | null;
  jobs: { sources: string[]; inserted: number } | null;
  errors: string[];
};

const CONTRIBUTE_MAX = 8; // contribute は 1 回最大 8 リンク

/** 企業 1 社のフルチェーン enrich。 cli backend 前提。 */
export async function runCompanyEnrichChain(companyId: string): Promise<EnrichChainSummary> {
  const summary: EnrichChainSummary = {
    companyId,
    companyName: '',
    discovered: { works: 0, career: 0, about: 0 },
    contribute: null,
    jobs: null,
    errors: [],
  };

  const company = await getCompany(companyId);
  if (!company) {
    summary.errors.push('company not found');
    return summary;
  }
  summary.companyName = company.name;
  if (!company.url) {
    summary.errors.push('company has no url (発見対象なし)');
    return summary;
  }

  const fetcher = new PoliteFetcher({
    userAgent: config.companyCrawl.userAgent,
    fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
    minIntervalMs: config.companyCrawl.minIntervalMs,
    respectRobots: config.companyCrawl.respectRobots,
  });
  const fetchText = async (url: string): Promise<string> => {
    const r = await fetcher.fetch(url);
    if (!r.ok) throw new Error(r.message);
    return r.html;
  };

  // career は個別職種ページ 1 枚 = 1 求人になりやすいので多めに拾う (一覧 SPA は後回し済み)。
  const site = await discoverSite(company.url, fetchText, { works: 6, career: 6, about: 2 });
  summary.discovered = {
    works: site.worksUrls.length,
    career: site.careerUrls.length,
    about: site.aboutUrls.length,
  };

  // 1) ゲーム紐付け + 企業情報 (contribute / cli)。
  const links = [...site.worksUrls, ...site.aboutUrls].slice(0, CONTRIBUTE_MAX);
  if (links.length > 0) {
    try {
      const c = await runContribute(companyId, links);
      const games = c.results.filter((r) => r.type === 'game' && r.applied).length;
      summary.contribute = { processed: c.processed, applied: c.applied, games };
    } catch (e) {
      summary.errors.push(`contribute: ${(e as Error).message}`);
    }
  }

  // 2) recruit-page 求人 (career URL ごとにアドホック recruit-page ソース)。
  if (site.careerUrls.length > 0) {
    const sources: NewsSourceConfig[] = site.careerUrls.map((url, i) => ({
      id: `auto-recruit:${companyId}:${i}`,
      kind: 'recruit-page',
      urls: [url],
      hiringOnly: false,
      newgradOnly: false, // 特定企業の全求人を拾う (recruit-page 既定)
      company: company.name,
      enabled: true,
    }));
    try {
      const j = await runJobNewsCrawl(undefined, sources);
      summary.jobs = { sources: j.sources, inserted: j.inserted };
      for (const e of j.errors) summary.errors.push(`jobs ${e.url}: ${e.message}`);
    } catch (e) {
      summary.errors.push(`jobs: ${(e as Error).message}`);
    }
  }

  return summary;
}
