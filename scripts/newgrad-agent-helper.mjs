// Workflow の各サブエージェントが新卒像要約のために SQLite を読み書きするヘルパ (依存ゼロ)。
//   node newgrad-agent-helper.mjs read  <companyId>            → 記事本文を stdout
//   node newgrad-agent-helper.mjs write <companyId> <jsonPath> → role 別像を upsert
// jsonPath は {"roles":{"general":{"summary":"...","themes":[...]}, "programmer":{...}, ...}} 形式。

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DB = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'tirocinium.sqlite');
const ROLES = ['general', 'planner', 'programmer', 'designer', 'sound'];
const MAX_CHARS = 60000;

const [cmd, companyId, jsonPath] = process.argv.slice(2);
const db = new DatabaseSync(DB);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");

if (cmd === 'read') {
  const c = db.prepare('SELECT name FROM companies WHERE id = ?').get(companyId);
  const arts = db
    .prepare('SELECT title, body FROM company_interview_articles WHERE company_id = ? ORDER BY fetched_at DESC LIMIT 30')
    .all(companyId);
  let out = `COMPANY: ${c?.name ?? '(unknown)'}\nARTICLES: ${arts.length}\n\n`;
  let used = 0;
  for (const a of arts) {
    const block = `# ${a.title}\n${a.body}\n\n---\n\n`;
    if (used + block.length > MAX_CHARS) break;
    out += block;
    used += block.length;
  }
  process.stdout.write(out);
} else if (cmd === 'write') {
  const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const roles = data.roles ?? data;
  const n = db.prepare('SELECT count(*) c FROM company_interview_articles WHERE company_id = ?').get(companyId).c;
  const stmt = db.prepare(`
    INSERT INTO company_newgrad_role_images (company_id, role, summary, themes, article_count, model)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(company_id, role) DO UPDATE SET
      summary=excluded.summary, themes=excluded.themes,
      article_count=excluded.article_count, model=excluded.model, fetched_at=datetime('now')
  `);
  const done = [];
  for (const role of ROLES) {
    const r = roles[role];
    if (r && typeof r.summary === 'string' && r.summary.trim()) {
      stmt.run(companyId, role, r.summary.trim(), JSON.stringify(Array.isArray(r.themes) ? r.themes : []), n, 'workflow:agent');
      done.push(role);
    }
  }
  process.stdout.write(`wrote ${companyId}: roles=[${done.join(',')}]\n`);
} else {
  process.stderr.write('usage: read <companyId> | write <companyId> <jsonPath>\n');
  process.exit(1);
}
