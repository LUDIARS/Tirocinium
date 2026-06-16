// 非公開 Sheet (合格リスト) → company_ob_placement 集計同期のコア (DB 非依存・テスト可能)。
// 純パース / 集計 / 差分は @tirocinium/companies (純粋)、 DB 反映 (解決・upsert・削除) は deps 注入。
// 実 DB / 実 Sheet の配線は ob-sheet-sync-wire.ts (syncObFromSheet) 側に置く (db import を core から排除)。 LLM 不使用。
//
// 個人データ境界 (§2.1): 入力は氏名つき個人行だが、 aggregateObPersons で集計に畳む過程で氏名は破棄され、
//   DB へは集計セル {company_id, 入社年, クラス, 役職, 人数} しか書かれない。 氏名の置き場は Sheet のみ。
// 差分 (3-a): Sheet 由来セル (source='sheet-sync') の DB 現状 (prev) vs Sheet 全量 (next) を突合し、
//   新規 upsert / headcount 変更 upsert / Sheet から消えたセルの削除 を行う (Sheet を正本とする同期)。
//   source!='sheet-sync' (手動 CSV 取込 = 'user' 等) のセルには触れない。
// spec/companies/game-graph.md §2.1 / §5.3。

import { parseObSheetValues, aggregateObPersons, diffObCells } from '@tirocinium/companies';
import type { ObCellRow } from './ob-repo.js';

/** Sheet 同期で書き込むセルの source タグ (この source のセルだけ同期対象)。 */
export const OB_SHEET_SOURCE = 'sheet-sync';

export type ObSheetSyncSummary = {
  /** Sheet から読んだ個人行数 (氏名は集計後に破棄)。 */
  persons: number;
  /** 集計後セル数。 */
  cells: number;
  /** company_id に解決できたセル数。 */
  resolved: number;
  /** 社名解決できず同期できなかったセル数。 */
  unresolved: number;
  /** 解決できなかった社名 (重複排除・最大 50 件)。 */
  unresolvedNames: string[];
  /** 新規追加セル数。 */
  added: number;
  /** headcount 変更セル数。 */
  updated: number;
  /** Sheet から消えて削除したセル数。 */
  removed: number;
  /** 同期で触れた企業数 (distinct)。 */
  companies: number;
  /** 解決済セルの総人数。 */
  headcount: number;
  /** dry-run (DB 反映せず差分のみ算出) か。 */
  dryRun: boolean;
};

/** 同期コアの外部依存 (DB / Sheet を注入。 テストで差し替え可能)。 */
export type ObSheetSyncDeps = {
  /** Sheet 値 (1 行目 = ヘッダ) を取得する。 */
  readValues(): Promise<string[][]>;
  /** 正規化社名 → company_id (未解決は null)。 */
  resolveCompanyId(normalizedName: string): Promise<string | null>;
  /** source='sheet-sync' の現状セル (差分 prev 側)。 */
  getExistingCells(): Promise<ObCellRow[]>;
  /** セルを upsert する (source='sheet-sync')。 */
  upsertCell(cell: ObCellRow): Promise<void>;
  /** セルを削除する。 */
  deleteCell(cell: ObCellRow): Promise<void>;
  /** true なら DB 反映せず差分のみ算出。 */
  dryRun?: boolean;
};

/** company_id 解決後セルの安定キー (差分突合用)。 */
const cellKey = (c: ObCellRow): string => `${c.company_id} ${c.join_year} ${c.class_name} ${c.role}`;

/**
 * Sheet 値を集計セルへ畳んで (氏名破棄) company_ob_placement を差分同期するコア。 DB 非依存・テスト可能。
 * @returns 同期サマリ (氏名は一切含まない)。
 */
export async function runObSheetSync(deps: ObSheetSyncDeps): Promise<ObSheetSyncSummary> {
  const dryRun = deps.dryRun ?? false;

  const values = await deps.readValues();
  const persons = parseObSheetValues(values); // 氏名つき個人行 (transient)
  const cells = aggregateObPersons(persons); // ← ここで氏名破棄。 以後 name は存在しない

  // 社名 → company_id 解決 (同名は 1 回に畳む)。 未解決はクロールせず報告のみ。
  const idByName = new Map<string, string | null>();
  const missing = new Set<string>();
  const next: ObCellRow[] = [];
  for (const cell of cells) {
    let companyId = idByName.get(cell.normalized_name);
    if (companyId === undefined) {
      companyId = await deps.resolveCompanyId(cell.normalized_name);
      idByName.set(cell.normalized_name, companyId);
    }
    if (!companyId) {
      missing.add(cell.company_name);
      continue;
    }
    next.push({
      company_id: companyId,
      join_year: cell.join_year,
      class_name: cell.class_name,
      role: cell.role,
      headcount: cell.headcount,
    });
  }

  // Sheet 由来セルの現状 (prev) と Sheet 全量 (next) を突合。
  const prev = await deps.getExistingCells();
  const diff = diffObCells(prev, next, cellKey);

  if (!dryRun) {
    for (const c of [...diff.added, ...diff.updated]) await deps.upsertCell(c);
    for (const c of diff.removed) await deps.deleteCell(c);
  }

  const touched = new Set(next.map((c) => c.company_id));
  return {
    persons: persons.length,
    cells: cells.length,
    resolved: next.length,
    unresolved: cells.length - next.length,
    unresolvedNames: [...missing].slice(0, 50),
    added: diff.added.length,
    updated: diff.updated.length,
    removed: diff.removed.length,
    companies: touched.size,
    headcount: next.reduce((s, c) => s + c.headcount, 0),
    dryRun,
  };
}
