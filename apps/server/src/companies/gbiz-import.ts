// gBizINFO 母集団取込の配線 (IO + DB)。 discover → 決定論マッピング → upsert (candidate)。
// マッピングは @tirocinium/companies の gbizInfoRecordToCompany (純粋) に委譲。 LLM 不使用・冪等。
// spec/feature/companies/gbizinfo.md §1③。 フラグ (isGame/hasOpening) はここでは立てない — HP裏取り (enrich) が確定する。

import {
  gbizInfoRecordToCompany,
  normalizeCompany,
  type NormalizedCompany,
} from '@tirocinium/companies';
import { config } from '../config.js';
import { upsertCompany } from './repo.js';
import {
  createGBizFetchClient,
  discoverHojin,
  type GBizClient,
  type GBizQuery,
} from './gbizinfo.js';

export type GBizImportOptions = {
  query: GBizQuery;
  max?: number;
  /** テスト用に client を注入する (省略時は config.gbiz.token で実 API client を作る)。 */
  client?: GBizClient;
};

export type GBizImportSummary = {
  /** discover で得た法人数 */
  discovered: number;
  inserted: number;
  updated: number;
  /** 法人番号付きで投入できた数 */
  withCorpNumber: number;
  /** 会社HP (company_url) を持っていた数 — §0 の検索ステップ要否の目安 */
  withUrl: number;
  /** 従業員数で中小確定できた数 (employee_count>0) */
  withEmployees: number;
  skipped: number;
};

/** 母集団取込。 client が無ければ config.gbiz.token から実 API client を作る (token 必須)。 */
export async function runGBizImport(opts: GBizImportOptions): Promise<GBizImportSummary> {
  const client =
    opts.client ??
    (() => {
      if (!config.gbiz.token) {
        throw new Error('GBIZINFO_TOKEN が未設定です (secret-agent / config-setup で設定してください)');
      }
      return createGBizFetchClient({
        token: config.gbiz.token,
        minIntervalMs: config.gbiz.minIntervalMs,
        userAgent: config.companyCrawl.userAgent,
      });
    })();

  const query: GBizQuery = {
    ...opts.query,
    industry: opts.query.industry || config.gbiz.defaultIndustry || undefined,
  };
  const records = await discoverHojin(client, query, { max: opts.max });

  const summary: GBizImportSummary = {
    discovered: records.length, inserted: 0, updated: 0,
    withCorpNumber: 0, withUrl: 0, withEmployees: 0, skipped: 0,
  };

  for (const rec of records) {
    const mapped = gbizInfoRecordToCompany(rec);
    const normalized: NormalizedCompany | null = mapped && normalizeCompany(mapped.input);
    if (!mapped || !normalized) {
      summary.skipped++;
      continue;
    }
    // candidate として upsert。 is_smb は upsertCompany が employee_count から純導出する。
    const status = await upsertCompany(normalized, { corporateNumber: mapped.corporate_number });
    if (status === 'inserted') summary.inserted++;
    else summary.updated++;
    if (mapped.corporate_number) summary.withCorpNumber++;
    if (normalized.url) summary.withUrl++;
    if (normalized.employee_count > 0) summary.withEmployees++;
  }

  return summary;
}
