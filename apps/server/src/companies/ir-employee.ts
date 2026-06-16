// IR / 会社情報ページをクロールして従業員数 (employee_count) を裏取りする (game-graph §5.4 Phase4)。
// 対象は employee_count=0 の上場社 / research 名寄れ失敗社。 抽出は決定論 (extractEmployeeFromIR、 LLM 不使用)。
// IR 本文は company_profiles.ir_summary (既存) に「ゲーム業界動向」用として保持する
// (ただし LLM 要約済みの社は壊さず、 未取得社のみ素の抜粋を入れる)。
// クロール → 抽出の純 IO は ir-employee-extract.ts に分離 (DB 非依存・テスト可能)。

import type { Company } from '@tirocinium/companies';
import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { companiesNeedingIrEmployee, getCompany, updateEmployeeCount } from './repo.js';
import { getProfile, upsertProfile } from './profile-repo.js';
import {
  extractEmployeeForCompany,
  emptyIrSummary,
  type UrlFetcher,
  type IrEmployeeSummary,
} from './ir-employee-extract.js';

export type IrEmployeeOptions = {
  /** 指定すると 1 社だけ処理する (employee_count の条件を問わない)。 */
  companyId?: string;
  /** 無指定一括クロール時の上限。 既定 20。 */
  limit?: number;
  /** テストや再実行用に fetcher を注入する (省略時は PoliteFetcher)。 */
  fetcher?: UrlFetcher;
};

/**
 * IR 従業員裏取りを実行する。 抽出できた社は employee_count + is_smb を更新し、
 * 巡回 IR 本文を (LLM 要約が無い社のみ) ir_summary に保持する。
 */
export async function runIrEmployeeCrawl(opts: IrEmployeeOptions = {}): Promise<IrEmployeeSummary> {
  const summary = emptyIrSummary();

  let targets: Company[];
  if (opts.companyId) {
    const c = await getCompany(opts.companyId);
    targets = c && c.url ? [c] : [];
  } else {
    targets = await companiesNeedingIrEmployee(opts.limit ?? 20);
  }
  summary.targets = targets.length;
  if (targets.length === 0) return summary;

  const fetcher: UrlFetcher =
    opts.fetcher ??
    new PoliteFetcher({
      userAgent: config.companyCrawl.userAgent,
      fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
      minIntervalMs: config.companyCrawl.minIntervalMs,
      respectRobots: config.companyCrawl.respectRobots,
    });
  const maxPages = config.companyCrawl.enrichMaxPages;

  for (const company of targets) {
    try {
      const { employeeCount, irText, fetchedUrls } = await extractEmployeeForCompany(
        fetcher, company, summary, maxPages,
      );
      if (employeeCount <= 0) {
        summary.unresolved++;
        continue;
      }
      await updateEmployeeCount(company.id, employeeCount);
      // IR 本文を ir_summary に保持 (LLM 要約が無い社のみ。 既存要約は壊さない)。
      const existing = await getProfile(company.id);
      if (!existing?.ir_summary) {
        await upsertProfile(company.id, {
          philosophy: existing?.philosophy ?? '',
          values: existing?.values ?? [],
          business: existing?.business ?? '',
          ir_summary: irText.replace(/\s+/g, ' ').trim().slice(0, 2000),
          sources: fetchedUrls,
        });
      }
      summary.resolved++;
    } catch (err) {
      summary.errors.push({ company: company.name, message: (err as Error).message });
    }
  }

  console.log(
    `[companies] ir-employee targets=${summary.targets} resolved=${summary.resolved} ` +
      `unresolved=${summary.unresolved} pages=${summary.pagesFetched} errors=${summary.errors.length}`,
  );
  return summary;
}
