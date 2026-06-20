// ユーザ付与の OB 就職実績 (CSV / JSON) を company_ob_placement へ取り込む配線 (IO + DB)。
// パース / 正規化 / 集計は @tirocinium/companies (純粋) に委譲。 LLM 不使用・冪等 (再取込安全)。
// spec/feature/companies/game-graph.md §5.3。

import { readFile } from 'node:fs/promises';
import {
  parseObInput,
  normalizeObPlacement,
  dedupeObPlacements,
  type NormalizedObPlacement,
} from '@tirocinium/companies';
import { getCompanyByNormalizedName } from './repo.js';
import { upsertObPlacement } from './ob-repo.js';

export type ObImportSummary = {
  /** 解析できた集計セル数 (正規化後) */
  total: number;
  /** company_id に解決して投入したセル数 */
  upserted: number;
  /** 社名解決できず投入できなかったセル数 */
  unresolved: number;
  /** 投入で触れた企業数 (distinct) */
  companies: number;
  /** 投入した総就職者数 (headcount 合算) */
  headcount: number;
  /** 解決できなかった社名 (重複排除・最大 50 件) */
  unresolvedNames: string[];
};

/**
 * 正規化済の OB 行を企業に解決して upsert する (純パース後の DB 段)。
 * 社名は normalized_name で companies に突合。 未解決はクロールせず報告のみ (ユーザ付与前提)。
 */
export async function importObPlacements(
  rows: NormalizedObPlacement[],
  source = 'user',
): Promise<ObImportSummary> {
  const deduped = dedupeObPlacements(rows);
  const summary: ObImportSummary = {
    total: deduped.length, upserted: 0, unresolved: 0, companies: 0, headcount: 0, unresolvedNames: [],
  };
  const touched = new Set<string>();
  const missing = new Set<string>();
  // 社名解決を 1 回に畳む (同名の重複解決を避ける)。
  const idByName = new Map<string, string | null>();

  for (const rec of deduped) {
    let companyId = idByName.get(rec.normalized_name);
    if (companyId === undefined) {
      const company = await getCompanyByNormalizedName(rec.normalized_name);
      companyId = company?.id ?? null;
      idByName.set(rec.normalized_name, companyId);
    }
    if (!companyId) {
      summary.unresolved++;
      missing.add(rec.company_name);
      continue;
    }
    await upsertObPlacement(companyId, rec, source);
    summary.upserted++;
    summary.headcount += rec.headcount;
    touched.add(companyId);
  }

  summary.companies = touched.size;
  summary.unresolvedNames = [...missing].slice(0, 50);
  return summary;
}

/** ファイル (CSV / JSON 自動判別) から OB 集計を取り込む。 */
export async function importObFile(path: string, source = 'user'): Promise<ObImportSummary> {
  const text = await readFile(path, 'utf8');
  const parsed = parseObInput(text);
  const normalized = parsed.map(normalizeObPlacement).filter((r): r is NormalizedObPlacement => r !== null);
  return importObPlacements(normalized, source);
}
