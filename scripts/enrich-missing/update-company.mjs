/**
 * 個別企業の情報を DB に書き込むヘルパー CLI
 *
 * 使い方:
 *   node --experimental-sqlite scripts/enrich-missing/update-company.mjs \
 *     --name "会社名" \
 *     --url "https://..." \
 *     --description "説明文" \
 *     --location "東京" \
 *     --industry "ゲーム" \
 *     --tags "tag1,tag2" \
 *     --size "100-300名" \
 *     --reason "注記" \
 *     [--tag "海外企業"|"個人企業"]
 *
 * --check-dup のみ指定すると重複確認だけ行う
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, '../../data/tirocinium.sqlite');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (key) => {
    const i = args.indexOf(key);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    name:        get('--name'),
    url:         get('--url'),
    description: get('--description'),
    location:    get('--location'),
    industry:    get('--industry'),
    tags:        get('--tags'),    // カンマ区切り
    size:        get('--size'),
    reason:      get('--reason'),
    addTag:      get('--tag'),     // 海外企業 or 個人企業
    checkDup:    args.includes('--check-dup'),
  };
}

function normalize(name) {
  return name.toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/株式会社|有限会社|合同会社|Inc\.|Ltd\.|LLC\.?/gi, '')
    .trim();
}

function findByName(db, name) {
  return db.prepare(`SELECT id, name, description, url, tags, stock_reason FROM companies WHERE name = ?`).get(name);
}

function findDuplicates(db, name) {
  const norm = normalize(name);
  const all = db.prepare(`SELECT id, name, description, url FROM companies`).all();
  return all.filter(r => {
    const n = normalize(r.name);
    return n === norm || n.includes(norm) || norm.includes(n);
  });
}

const opts = parseArgs();
const db = new DatabaseSync(DB_PATH);

// 重複確認モード
if (opts.checkDup && opts.name) {
  const dups = findDuplicates(db, opts.name);
  if (dups.length === 0) {
    console.log(`重複なし: "${opts.name}"`);
  } else {
    console.log(`重複候補 ${dups.length} 件: "${opts.name}"`);
    for (const d of dups) {
      console.log(`  id=${d.id} name="${d.name}" url=${d.url || '(なし)'} desc=${d.description ? d.description.slice(0,40) + '...' : '(なし)'}`);
    }
  }
  db.close();
  process.exit(0);
}

if (!opts.name) {
  console.error('--name が必要です');
  process.exit(1);
}

const row = findByName(db, opts.name);
if (!row) {
  console.error(`企業が見つかりません: "${opts.name}"`);
  db.close();
  process.exit(1);
}

// タグ更新
if (opts.addTag || opts.tags) {
  const cur = JSON.parse(row.tags || '[]');
  if (opts.addTag && !cur.includes(opts.addTag)) cur.push(opts.addTag);
  if (opts.tags) {
    for (const t of opts.tags.split(',').map(t => t.trim()).filter(Boolean)) {
      if (!cur.includes(t)) cur.push(t);
    }
  }
  db.prepare(`UPDATE companies SET tags = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(cur), row.id);
}

// フィールド更新
const updates = [];
const params = [];
if (opts.url        && !row.url)         { updates.push('url = ?');         params.push(opts.url); }
if (opts.description && !row.description) { updates.push('description = ?'); params.push(opts.description); }
if (opts.location)   { updates.push('location = ?');    params.push(opts.location); }
if (opts.industry)   { updates.push('industry = ?');    params.push(opts.industry); }
if (opts.size)       { updates.push('size = ?');        params.push(opts.size); }

// stock_reason 追記
if (opts.reason) {
  const cur = row.stock_reason || '';
  if (!cur.includes(opts.reason.slice(0, 20))) {
    const next = cur ? cur + ' | ' + opts.reason : opts.reason;
    updates.push('stock_reason = ?');
    params.push(next);
  }
}

if (updates.length > 0) {
  updates.push("updated_at = datetime('now')");
  params.push(row.id);
  db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(row.id);
console.log(`✓ 更新完了: ${updated.name}`);
console.log(`  url: ${updated.url || '(なし)'}`);
console.log(`  description: ${updated.description ? updated.description.slice(0, 80) + '...' : '(なし)'}`);
console.log(`  location: ${updated.location || '(なし)'}`);
console.log(`  tags: ${updated.tags}`);
console.log(`  reason: ${updated.stock_reason || '(なし)'}`);

db.close();
