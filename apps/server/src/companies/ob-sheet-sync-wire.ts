// ob-sheet-sync コアに実 DB / 実 Sheet を配線する層 (route / CLI から呼ぶ)。
// db import を core (ob-sheet-sync.ts) から分離し、 core を DB 非依存・テスト可能に保つ。
// spec/feature/companies/game-graph.md §5.3。

import { config } from '../config.js';
import { getCompanyByNormalizedName } from './repo.js';
import { upsertObPlacement, getObPlacementsBySource, deleteObPlacement } from './ob-repo.js';
import { readSheetValues } from './google-sheets.js';
import { runObSheetSync, OB_SHEET_SOURCE, type ObSheetSyncSummary } from './ob-sheet-sync.js';

/** config から Sheet を読む既定 reader (creds / id 未設定は明示エラー)。 */
function defaultReader(): Promise<string[][]> {
  const s = config.obSheet;
  if (!s.serviceAccountJson) throw new Error('OB Sheet 同期: service account 未設定 (TIROCINIUM_OB_SHEET_SA_JSON)');
  if (!s.spreadsheetId) throw new Error('OB Sheet 同期: spreadsheet id 未設定 (TIROCINIUM_OB_SHEET_ID)');
  return readSheetValues({
    serviceAccountJson: s.serviceAccountJson,
    spreadsheetId: s.spreadsheetId,
    range: s.range || 'A:Z',
  });
}

/** 実 DB / 実 Sheet を配線して OB 合格リストを差分同期する。 */
export function syncObFromSheet(
  opts: { dryRun?: boolean; readValues?: () => Promise<string[][]> } = {},
): Promise<ObSheetSyncSummary> {
  return runObSheetSync({
    readValues: opts.readValues ?? defaultReader,
    resolveCompanyId: async (n) => (await getCompanyByNormalizedName(n))?.id ?? null,
    getExistingCells: () => getObPlacementsBySource(OB_SHEET_SOURCE),
    upsertCell: (c) => upsertObPlacement(c.company_id, c, OB_SHEET_SOURCE),
    deleteCell: (c) => deleteObPlacement(c.company_id, c.join_year, c.class_name, c.role),
    dryRun: opts.dryRun,
  });
}
