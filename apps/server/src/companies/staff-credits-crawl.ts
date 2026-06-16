// スタッフロール掲載元 (MobyGames / Wikipedia クレジット節 / 4Gamer 等) をクロールし、
// Game↔企業 (developer/publisher/support/credited) を発見する。 決定論パース (LLM 不使用)。
// 未知企業は source='staff-credits' で upsert → 未検知企業の自動発見。 game-graph §5.2。
// ToS は source ごとに要確認のため、 listing-sources.json で既定 disabled + opt-in 運用。

import { normalizeCompany, normalizeGame, htmlToText } from '@tirocinium/companies';
import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { loadListingSources, selectActiveSources } from './listing-config.js';
import { getCompanyByNormalizedName, upsertCompany } from './repo.js';
import { getGameByNormalizedTitle, upsertGame, linkCompanyGame } from './games-repo.js';
import {
  ingestStaffCredits,
  emptyStaffCreditsSummary,
  type StaffCreditsDeps,
  type StaffCreditsSummary,
} from './staff-credits-ingest.js';

/** 実 deps を組む (決定論・LLM 不使用)。 source.id をゲーム出所に使う。 */
function realDeps(sourceId: string): StaffCreditsDeps {
  return {
    async resolveGameId(title) {
      const ng = normalizeGame({ title, source: sourceId, source_url: '' });
      if (!ng) return null;
      await upsertGame(ng);
      return (await getGameByNormalizedTitle(ng.normalized_title))?.id ?? null;
    },
    async resolveCompanyId(name) {
      const nc = normalizeCompany({ name, industry: 'ゲーム', source: 'staff-credits' });
      if (!nc) return null;
      const before = await getCompanyByNormalizedName(nc.normalized_name);
      await upsertCompany(nc, { isGame: true });
      const after = await getCompanyByNormalizedName(nc.normalized_name);
      if (!after) return null;
      return { id: after.id, isNew: before === null };
    },
    async link(companyId, gameId, role) {
      await linkCompanyGame(companyId, gameId, role, 'staff-credits');
    },
  };
}

/** スタッフロール発見クロールを実行する。 sourceId 指定で 1 ソースに絞れる。 kind='staff-credits' のみ対象。 */
export async function runStaffCreditsCrawl(sourceId?: string): Promise<StaffCreditsSummary> {
  const summary = emptyStaffCreditsSummary();
  const sources = selectActiveSources(await loadListingSources(), sourceId)
    .filter((s) => s.kind === 'staff-credits');
  if (sources.length === 0) return summary;

  const fetcher = new PoliteFetcher({
    userAgent: config.companyCrawl.userAgent,
    fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
    minIntervalMs: config.companyCrawl.minIntervalMs,
    respectRobots: config.companyCrawl.respectRobots,
  });
  const maxPages = config.companyCrawl.maxPages;
  let pageCount = 0;

  for (const source of sources) {
    summary.sources.push(source.id);
    const deps = realDeps(source.id);
    for (const url of source.urls) {
      if (pageCount >= maxPages) break;
      pageCount++;
      const res = await fetcher.fetch(url);
      if (!res.ok) {
        if (res.reason === 'robots') summary.robotsBlocked++;
        else summary.errors.push({ url, message: res.message });
        continue;
      }
      summary.pagesFetched++;
      try {
        await ingestStaffCredits(htmlToText(res.html, config.companyCrawl.listingMaxChars), deps, summary);
      } catch (err) {
        summary.errors.push({ url, message: (err as Error).message });
      }
    }
  }

  console.log(
    `[companies] staff-credits sources=${summary.sources.join(',')} games=${summary.games} ` +
      `edges=${summary.edges} newCompanies=${summary.newCompanies} ` +
      `robotsBlocked=${summary.robotsBlocked} errors=${summary.errors.length}`,
  );
  return summary;
}
