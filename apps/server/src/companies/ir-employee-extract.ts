// IR / 会社情報ページのクロール → 従業員数抽出 (DB 非依存の純 IO)。
// DB 配線 (対象選定・更新) は ir-employee.ts。 抽出は決定論 (extractEmployeeFromIR、 LLM 不使用)。
// game-graph §5.4 Phase4。

import {
  selectEnrichmentLinks,
  htmlToText,
  extractEmployeeFromIR,
  type Company,
  type EnrichmentLinks,
} from '@tirocinium/companies';
import type { FetchResult } from './fetcher.js';

/** fetch の最小インタフェース (テストで差し替え可能。 PoliteFetcher が満たす)。 */
export interface UrlFetcher {
  fetch(url: string): Promise<FetchResult>;
}

export type IrEmployeeSummary = {
  /** クロール対象社数 */
  targets: number;
  /** employee_count を確定できた社数 */
  resolved: number;
  /** クロールしたが従業員数を抽出できなかった社数 */
  unresolved: number;
  pagesFetched: number;
  robotsBlocked: number;
  errors: { company: string; message: string }[];
};

export const emptyIrSummary = (): IrEmployeeSummary => ({
  targets: 0, resolved: 0, unresolved: 0, pagesFetched: 0, robotsBlocked: 0, errors: [],
});

// IR / 会社概要ページを優先順に平坦化する。 採用/理念は従業員数の出典になりにくいので IR > about のみ採る。
function irFetchList(links: EnrichmentLinks, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [...links.ir, ...links.about]) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 1 社の IR / 会社概要を巡回し従業員数を抽出する。 DB 非依存 (純 IO、 テスト可能)。
 * ホーム → 同一ホストの IR/about ページを辿り、 本文を連結して {@link extractEmployeeFromIR} に通す。
 */
export async function extractEmployeeForCompany(
  fetcher: UrlFetcher,
  company: Pick<Company, 'name' | 'url'>,
  summary: IrEmployeeSummary,
  maxPages: number,
): Promise<{ employeeCount: number; irText: string; fetchedUrls: string[] }> {
  const empty = { employeeCount: 0, irText: '', fetchedUrls: [] as string[] };
  if (!company.url) return empty;

  const home = await fetcher.fetch(company.url);
  if (!home.ok) {
    if (home.reason === 'robots') summary.robotsBlocked++;
    return empty;
  }
  summary.pagesFetched++;

  const links = selectEnrichmentLinks(company.url, home.html);
  const pages = irFetchList(links, maxPages);
  const sections: string[] = [htmlToText(home.html, 4000)];
  const fetchedUrls: string[] = [company.url];
  for (const u of pages) {
    const res = await fetcher.fetch(u);
    if (!res.ok) {
      if (res.reason === 'robots') summary.robotsBlocked++;
      continue;
    }
    summary.pagesFetched++;
    sections.push(htmlToText(res.html, 4000));
    fetchedUrls.push(u);
  }

  const irText = sections.join('\n\n');
  return { employeeCount: extractEmployeeFromIR(irText), irText, fetchedUrls };
}
