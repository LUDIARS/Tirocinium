// 移行の報告を人が読む行にする。件数・表名・列名・rowid・理由だけを出し、値そのものは出さない。

const MAX_INVALID_LINES = 200;

export function formatReport(report) {
  const lines = [];
  lines.push(report.dryRun ? '== dry-run (書き込みなし) ==' : '== 投入 ==');
  if (report.problems?.length) {
    lines.push(`対応の無い表・列: ${report.problems.length} 件`);
    for (const p of report.problems) lines.push(`  - ${p}`);
  }
  for (const s of report.skipped ?? []) lines.push(`移さない表 ${s.table}: ${s.rows} 行 (${s.reason})`);
  for (const t of report.internalTables ?? []) lines.push(`移さない表 ${t}: SQLite の内部の表`);
  for (const t of report.tables ?? []) {
    let line = `${t.source} → ${t.target}: 元 ${t.sourceRows} 行 / 投入 ${t.importRows} 行`;
    if (t.invalidRows) line += ` / 変換不能 ${t.invalidRows} 行`;
    lines.push(line);
    for (const e of t.excluded) lines.push(`    除外 ${e.rows} 行: ${e.reason}`);
  }
  const invalid = report.invalid ?? [];
  if (invalid.length) {
    lines.push(`変換不能の値: ${invalid.length} 件 (表 / rowid / 列 / 理由)`);
    for (const i of invalid.slice(0, MAX_INVALID_LINES)) lines.push(`  - ${i.table} rowid=${i.rowid} ${i.column}: ${i.reason}`);
    if (invalid.length > MAX_INVALID_LINES) lines.push(`  … ほか ${invalid.length - MAX_INVALID_LINES} 件`);
  }
  if (report.nonEmptyTables?.length) lines.push(`移し先で行のある表: ${report.nonEmptyTables.join(', ')}`);
  for (const s of report.sequences ?? []) lines.push(`sequence ${s.table}.${s.column} → ${s.value}`);
  return lines.join('\n');
}
