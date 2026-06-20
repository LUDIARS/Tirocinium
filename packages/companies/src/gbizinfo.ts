// gBizINFO (経産省 法人情報 REST API) の raw record → CompanyInput への決定論マッピング。
// 純粋関数 (LLM・IO 不使用)。 spec/feature/companies/gbizinfo.md §1②。
//
// ⚠️ フィールド名は gBizINFO v1 /hojin の公開スキーマ準拠。 実 API での充足率確認
//    (company_url 欠落率 / industry 粒度) は token 取得後に行う (spec §2 の注記)。
// 個人データ境界: representative_name 等の個人列はマッピングしない (会社属性のみ採る)。

import type { CompanyInput } from './types.js';

/** gBizINFO /hojin の 1 法人レコード (利用するフィールドのみ。 他は無視)。 */
export type GBizHojin = {
  corporate_number?: string;
  name?: string;
  location?: string;
  postal_code?: string;
  /** 会社HP (欠落しうる)。 §0 の「社名→HP特定」要否はこの充足率で決まる。 */
  company_url?: string;
  /** 事業概要 (industry ヒント) */
  business_summary?: string;
  /** 日本標準産業分類の事業 (タグ化) */
  business_items?: string[];
  /** 従業員数 (is_smb 権威確定の材料) */
  employee_number?: number;
  /** 設立日 'YYYY-MM-DD' */
  date_of_establishment?: string;
};

/** 法人番号を 13 桁の数字列に正規化する (不正は '')。 */
export function normalizeCorporateNumber(v: string | undefined): string {
  const digits = (v ?? '').replace(/[^0-9]/g, '');
  return digits.length === 13 ? digits : '';
}

/** gBizINFO の公開法人詳細ページ URL (source_url / 出所として保持)。 */
export function gbizHojinUrl(corporateNumber: string): string {
  const n = normalizeCorporateNumber(corporateNumber);
  return n ? `https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${n}` : '';
}

const str = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max);

function toEmployeeCount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** business_items / business_summary を industry / tags のヒントに畳む。 */
function deriveIndustry(rec: GBizHojin): string {
  const summary = str(rec.business_summary, 120);
  if (summary) return summary;
  const first = (rec.business_items ?? []).map((s) => str(s, 60)).find(Boolean);
  return first ?? '';
}

/** gBizINFO record → { CompanyInput, corporate_number }。 法人番号 or 社名が無ければ null。 */
export function gbizInfoRecordToCompany(
  rec: GBizHojin,
): { input: CompanyInput; corporate_number: string } | null {
  const name = str(rec.name, 200);
  if (!name) return null;
  const corporate_number = normalizeCorporateNumber(rec.corporate_number);
  const sourceUrl = gbizHojinUrl(corporate_number);
  const tags = (rec.business_items ?? [])
    .map((s) => str(s, 60))
    .filter(Boolean)
    .slice(0, 12);
  const input: CompanyInput = {
    name,
    url: str(rec.company_url, 500),
    industry: deriveIndustry(rec),
    location: str(rec.location, 120),
    tags,
    employeeCount: toEmployeeCount(rec.employee_number),
    source: 'gbizinfo',
    source_url: sourceUrl,
  };
  return { input, corporate_number };
}
