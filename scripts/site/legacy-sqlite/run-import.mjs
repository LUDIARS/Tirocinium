// 移行の本体: 計画 → (dry-run なら件数と変換不能の行を返す) → 空の DB に 1 トランザクションで投入。
// 変換できない行・対応の無い表/列が 1 つでもあれば、何も書かずに止める。

import { buildPlan } from './table-plan.mjs';
import { countRows, listColumns, listInternalTables, listTables } from './sqlite.mjs';
import { mainCompanyKeys, readEntryRows } from './read-rows.mjs';
import {
  assertMigrated,
  insertOrder,
  insertRows,
  nonEmptyTables,
  readTargetSchema,
  syncSequences,
} from './pg-target.mjs';

export class ImportStopped extends Error {
  constructor(message, report) {
    super(message);
    this.report = report;
  }
}

function readSourceSchema(db) {
  const tables = {};
  const rowCounts = {};
  for (const t of listTables(db)) {
    tables[t] = listColumns(db, t);
    rowCounts[t] = countRows(db, t);
  }
  return { tables, rowCounts };
}

/** 計画と全行の変換。書き込みはしない。 */
function prepare(db, targetSchema, order) {
  const sourceSchema = readSourceSchema(db);
  const plan = buildPlan(sourceSchema, targetSchema);
  const report = {
    internalTables: listInternalTables(db),
    skipped: plan.skipped,
    problems: plan.problems,
    tables: [],
    invalid: [],
  };
  if (plan.problems.length) return { report, batches: [] };
  const ctx = { mainCompanies: mainCompanyKeys(db, sourceSchema.tables), addedLegacyCompanyIds: new Set() };
  const batches = [];
  for (const target of order(plan.entries.map((e) => e.target))) {
    const group = plan.entries.filter((e) => e.target === target);
    group.sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'main' ? -1 : 1));
    for (const entry of group) {
      const { rows, invalid, excluded } = readEntryRows(db, entry, ctx);
      report.tables.push({
        source: entry.source,
        target: entry.target,
        sourceRows: sourceSchema.rowCounts[entry.source] ?? 0,
        importRows: rows.length,
        invalidRows: new Set(invalid.map((i) => i.rowid)).size,
        excluded,
      });
      report.invalid.push(...invalid);
      batches.push({ entry, rows });
    }
  }
  return { report, batches };
}

/**
 * db: 開いた bundle、sql: postgres の接続、dryRun: true なら書かない。
 * 戻り値: report (表ごとの件数・除いた行・変換不能の行・sequence)。止まるときは ImportStopped。
 */
export async function runImport({ db, sql, dryRun }) {
  const targetSchema = await readTargetSchema(sql);
  assertMigrated(targetSchema);
  const uniqueTargets = (targets) => [...new Set(targets)];
  // 外部キーの順は Postgres の制約から決める (dry-run でも同じ順で読む: companies → company_profiles など)。
  const order = await insertOrder(sql, uniqueTargets(Object.keys(targetSchema)));
  const orderOf = (targets) => order.filter((t) => targets.includes(t));
  const { report, batches } = prepare(db, targetSchema, orderOf);
  report.dryRun = dryRun;
  report.nonEmptyTables = await nonEmptyTables(sql, targetSchema);
  if (report.problems.length) throw new ImportStopped('対応の無い表・列がある', report);
  if (report.invalid.length) throw new ImportStopped('変換できない行がある', report);
  if (dryRun) return report;
  if (report.nonEmptyTables.length) throw new ImportStopped('移し先の DB が空ではない', report);

  report.sequences = [];
  await sql.begin(async (tx) => {
    // 同じ確認をトランザクションの中でもう一度行う (確認から投入までの間に書かれていないこと)。
    const again = await nonEmptyTables(tx, targetSchema);
    if (again.length) throw new ImportStopped('移し先の DB が空ではない', { ...report, nonEmptyTables: again });
    for (const { entry, rows } of batches) await insertRows(tx, entry.target, entry.columns, rows);
    for (const table of new Set(batches.map((b) => b.entry.target))) {
      for (const s of await syncSequences(tx, table, targetSchema[table])) report.sequences.push({ table, ...s });
    }
  });
  return report;
}
