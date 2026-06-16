/**
 * enrich-missing/process.mjs
 * 情報不足企業の分類・エンリッチ処理スクリプト
 *
 * 使い方:
 *   node --experimental-sqlite scripts/enrich-missing/process.mjs [--offset N] [--limit N]
 *
 * DB を直接読み書きする。サーバ停止中に実行すること。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, '../../data/tirocinium.sqlite');

const args = process.argv.slice(2);
const offsetIdx = args.indexOf('--offset');
const limitIdx  = args.indexOf('--limit');
const OFFSET = offsetIdx !== -1 ? parseInt(args[offsetIdx + 1]) : 0;
const LIMIT  = limitIdx  !== -1 ? parseInt(args[limitIdx  + 1]) : 50;

export function openDb() {
  return new DatabaseSync(DB_PATH);
}

/** 未処理対象企業を取得 (description='' かつ game edge あり、かつ未分類) */
export function fetchTargets(db, offset, limit) {
  return db.prepare(`
    SELECT c.id, c.name, c.url, c.location, c.industry, c.tags, c.source, c.stock_reason,
      (SELECT GROUP_CONCAT(g.title, ' / ')
       FROM (SELECT g2.title FROM company_game cg2 JOIN games g2 ON g2.id = cg2.game_id
             WHERE cg2.company_id = c.id ORDER BY g2.release_year DESC LIMIT 4) g) AS games_sample,
      (SELECT COUNT(*) FROM company_game cg WHERE cg.company_id = c.id) AS game_count
    FROM companies c
    WHERE c.description = ''
      AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
      AND c.tags NOT LIKE '%個人企業%'
      AND c.tags NOT LIKE '%海外企業%'
    ORDER BY game_count DESC, c.name
    LIMIT ${limit} OFFSET ${offset}
  `).all();
}

/** タグを追加 (重複なし) */
export function addTag(db, id, tag) {
  const row = db.prepare('SELECT tags FROM companies WHERE id = ?').get(id);
  const current = JSON.parse(row.tags || '[]');
  if (current.includes(tag)) return;
  current.push(tag);
  db.prepare(
    `UPDATE companies SET tags = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(current), id);
}

/** stock_reason を追記 */
export function appendReason(db, id, note) {
  const row = db.prepare('SELECT stock_reason FROM companies WHERE id = ?').get(id);
  const current = row.stock_reason || '';
  const next = current ? current + ' | ' + note : note;
  db.prepare(`UPDATE companies SET stock_reason = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(next, id);
}

/** URL を更新 */
export function updateUrl(db, id, url) {
  db.prepare(`UPDATE companies SET url = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(url, id);
}

/** description を更新 */
export function updateDescription(db, id, description) {
  db.prepare(`UPDATE companies SET description = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(description, id);
}

// CLI として直接実行した場合: 現在のバッチを表示
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM companies c
    WHERE c.description = ''
      AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
      AND c.tags NOT LIKE '%個人企業%'
      AND c.tags NOT LIKE '%海外企業%'
  `).get().n;

  const rows = fetchTargets(db, OFFSET, LIMIT);
  console.log(`\n=== 未処理企業 残り ${total} 社 (offset=${OFFSET}, limit=${LIMIT}) ===\n`);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(`[${OFFSET + i + 1}] ${r.name} (${r.game_count}本) url=${r.url || '(なし)'} loc=${r.location || '(なし)'}`);
    console.log(`    games: ${r.games_sample || '(なし)'}`);
    console.log(`    tags: ${r.tags} reason: ${r.stock_reason || ''}`);
  }
  db.close();
}
