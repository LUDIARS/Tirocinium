// 計画の 1 表ぶんの行を bundle から読み、変換する。変換できない値は (表・rowid・列・理由) で集める。
// data/companies.sqlite 由来の行は、tirocinium.sqlite 側と重なる企業を除く (table-plan.mjs の COMPANIES_TABLES)。

import { convertValue } from './convert.mjs';
import { iterateRows } from './sqlite.mjs';
import { COMPANIES_PREFIX } from './bundle.mjs';
import { COMPANIES_TABLES } from './table-plan.mjs';

/** tirocinium.sqlite 側の企業の id と normalized_name (重なりの判定用)。 */
export function mainCompanyKeys(db, sourceTables) {
  const ids = new Set();
  const names = new Set();
  if (!sourceTables.companies) return { ids, names };
  for (const row of db.prepare('SELECT id, normalized_name FROM companies').iterate()) {
    ids.add(String(row.id).toLowerCase());
    names.add(row.normalized_name);
  }
  return { ids, names };
}

/**
 * entry の行を変換する。
 * ctx: { mainCompanies, addedLegacyCompanyIds: Set (companies 由来で足した企業の id。ここで書き足す) }
 * 戻り値: { rows: (string|null)[][], invalid: [{ table, rowid, column, reason }], excluded: [{ reason, rows }] }
 */
export function readEntryRows(db, entry, ctx) {
  const rows = [];
  const invalid = [];
  const excludedCounts = new Map();
  const exclude = (reason) => excludedCounts.set(reason, (excludedCounts.get(reason) ?? 0) + 1);
  const names = entry.columns.map((c) => c.name);
  const legacy = entry.origin === 'companies' ? COMPANIES_TABLES[entry.source.slice(COMPANIES_PREFIX.length)] : null;

  for (const raw of iterateRows(db, entry.source, names)) {
    if (legacy && !keepLegacyRow(raw, legacy, ctx, exclude)) continue;
    const converted = [];
    let bad = false;
    for (const column of entry.columns) {
      const result = convertValue(raw[column.name], column);
      if (result.error) {
        invalid.push({ table: entry.source, rowid: String(raw.__rowid), column: column.name, reason: result.error });
        bad = true;
      } else {
        converted.push(result.value);
      }
    }
    if (bad) continue;
    rows.push(converted);
    if (legacy && !legacy.parent) ctx.addedLegacyCompanyIds.add(String(raw.id).toLowerCase());
  }
  const excluded = [...excludedCounts].map(([reason, n]) => ({ reason, rows: n }));
  return { rows, invalid, excluded };
}

function keepLegacyRow(raw, legacy, ctx, exclude) {
  if (legacy.parent) {
    const parentId = String(raw[legacy.parentKey] ?? '').toLowerCase();
    if (!ctx.addedLegacyCompanyIds.has(parentId)) {
      exclude('企業を tirocinium.sqlite 側で採ったので、companies.sqlite の付属行は足さない');
      return false;
    }
    return true;
  }
  const id = String(raw.id ?? '').toLowerCase();
  if (ctx.mainCompanies.ids.has(id) || ctx.mainCompanies.names.has(raw.normalized_name)) {
    exclude('同じ企業 (id か normalized_name) が tirocinium.sqlite にあるので、そちらを採る');
    return false;
  }
  return true;
}
