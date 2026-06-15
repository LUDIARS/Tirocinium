// 既知企業を起点に Wikidata から games / 共演企業 / シリーズ / 取引先(開発元↔発売元) を投入する。
// spec/companies/game-graph.md Phase2 (発見クロール)。 公開オープンデータ・決定論・LLM 不使用。

import { normalizeCompany, normalizeName, normalizeGame } from '@tirocinium/companies';
import { allCompaniesForScoring, getCompanyByNormalizedName, upsertCompany } from './repo.js';
import { getGameByNormalizedTitle, linkCompanyGame, linkPartner, upsertGame } from './games-repo.js';
import { fetchGamesForCompany, cleanCompanyLabel } from './wikidata.js';

export type WikidataEnrichSummary = {
  companiesScanned: number;
  gamesUpserted: number;
  newCompanies: number;
  gameEdges: number;
  partnerEdges: number;
  seriesTagged: number;
  errors: { company: string; message: string }[];
};

export type WikidataEnrichOptions = {
  /** 走査する既知企業の上限 (既定 全件) */
  limit?: number;
  /** SPARQL 間の最小間隔 ms (礼節) */
  minIntervalMs?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runWikidataEnrich(opts: WikidataEnrichOptions = {}): Promise<WikidataEnrichSummary> {
  const summary: WikidataEnrichSummary = {
    companiesScanned: 0, gamesUpserted: 0, newCompanies: 0, gameEdges: 0, partnerEdges: 0, seriesTagged: 0, errors: [],
  };
  const interval = opts.minIntervalMs ?? 300;
  const companies = await allCompaniesForScoring(opts.limit ?? 5000);

  // 社名 → company_id 解決キャッシュ。 未知社は discovery として upsert する。
  const idCache = new Map<string, string>();
  for (const c of companies) idCache.set(c.normalized_name, c.id);

  const resolveCompany = async (name: string): Promise<string | null> => {
    const norm = normalizeName(name);
    if (!norm) return null;
    const cached = idCache.get(norm);
    if (cached) return cached;
    let existing = await getCompanyByNormalizedName(norm);
    if (!existing) {
      const nc = normalizeCompany({ name, industry: 'ゲーム', source: 'wikidata', source_url: 'https://www.wikidata.org' });
      if (!nc) return null;
      await upsertCompany(nc, { isGame: true });
      existing = await getCompanyByNormalizedName(nc.normalized_name);
      if (existing) summary.newCompanies++;
    }
    if (!existing) return null;
    idCache.set(norm, existing.id);
    return existing.id;
  };

  for (const company of companies) {
    if (!cleanCompanyLabel(company.name)) continue;
    summary.companiesScanned++;
    let games;
    try {
      games = await fetchGamesForCompany(company.name);
    } catch (err) {
      summary.errors.push({ company: company.name, message: (err as Error).message });
      await sleep(interval);
      continue;
    }

    for (const g of games) {
      const series = g.series[0] ?? '';
      const ng = normalizeGame({
        title: g.title, series, source: 'wikidata', source_url: 'https://www.wikidata.org',
      });
      if (!ng) continue;
      await upsertGame(ng);
      summary.gamesUpserted++;
      if (series) summary.seriesTagged++;
      const node = await getGameByNormalizedTitle(ng.normalized_title);
      if (!node) continue;

      const devIds: string[] = [];
      const pubIds: string[] = [];
      for (const dev of g.developers) {
        const id = await resolveCompany(dev);
        if (id) { await linkCompanyGame(id, node.id, 'developer', 'wikidata'); summary.gameEdges++; devIds.push(id); }
      }
      for (const pub of g.publishers) {
        const id = await resolveCompany(pub);
        if (id) { await linkCompanyGame(id, node.id, 'publisher', 'wikidata'); summary.gameEdges++; pubIds.push(id); }
      }
      // 取引先 edge: 開発元 (vendor) ↔ 発売元 (client)。
      for (const d of devIds) {
        for (const p of pubIds) {
          if (d === p) continue;
          await linkPartner(d, p, 'client', 'wikidata');   // 開発元から見て発売元は client
          await linkPartner(p, d, 'vendor', 'wikidata');   // 発売元から見て開発元は vendor
          summary.partnerEdges += 2;
        }
      }
    }
    await sleep(interval);
  }
  return summary;
}
