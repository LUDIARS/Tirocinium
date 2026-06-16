// Wikidata 発見社 (url 未取得) の公式HP を Wikidata の official website (P856) で埋める。
// game-graph §0 / 名寄れ補完。 オーケストレーションは DB 非依存 (deps 注入・テスト可能)。
// 対象選定 / 反映 (repo) と SPARQL (wikidata.ts) は CLI 側で実 deps を組む。 決定論・LLM 不使用。

import type { Company } from '@tirocinium/companies';

export type WikidataUrlTarget = Pick<Company, 'id' | 'name'>;

/** runWikidataUrlFill の外部依存 (DB / SPARQL は注入する)。 */
export type WikidataUrlDeps = {
  /** url 未取得の Wikidata 発見社を limit 件取る。 */
  loadTargets(limit: number): Promise<WikidataUrlTarget[]>;
  /** 社名ラベルから公式HP を解決する (見つからなければ '')。 */
  resolveSite(label: string): Promise<string>;
  /** company の url を埋める (1 行ヒットで true)。 */
  applyUrl(id: string, url: string): Promise<boolean>;
};

export type WikidataUrlOptions = {
  /** 処理上限 (既定 50)。 */
  limit?: number;
  /** SPARQL 間の最小間隔 ms (礼節、 既定 300)。 */
  minIntervalMs?: number;
};

export type WikidataUrlSummary = {
  targets: number;
  /** 公式HP を埋められた社数 */
  filled: number;
  /** 解決できなかった (P856 無し / 同名不一致) 社数 */
  notFound: number;
  errors: { company: string; message: string }[];
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wikidata 発見社の公式HP を順次解決して url を埋める。
 * 解決は同一社名ラベルの組織 (Q43229) に限定 ([[wikidata.ts]] fetchOfficialSite)。
 * url が埋まると以後の自動 enrich キューに乗る ([[repo.ts]] updateCompanyInfo)。
 */
export async function runWikidataUrlFill(
  deps: WikidataUrlDeps,
  opts: WikidataUrlOptions = {},
): Promise<WikidataUrlSummary> {
  const summary: WikidataUrlSummary = { targets: 0, filled: 0, notFound: 0, errors: [] };
  const interval = opts.minIntervalMs ?? 300;

  const targets = await deps.loadTargets(opts.limit ?? 50);
  summary.targets = targets.length;

  for (let i = 0; i < targets.length; i++) {
    const c = targets[i]!;
    try {
      const site = await deps.resolveSite(c.name);
      if (site) {
        const applied = await deps.applyUrl(c.id, site);
        if (applied) summary.filled++;
        else summary.notFound++;
      } else {
        summary.notFound++;
      }
    } catch (err) {
      summary.errors.push({ company: c.name, message: (err as Error).message });
    }
    if (i < targets.length - 1) await sleep(interval);
  }

  console.log(
    `[companies] wikidata-url targets=${summary.targets} filled=${summary.filled} ` +
      `notFound=${summary.notFound} errors=${summary.errors.length}`,
  );
  return summary;
}
