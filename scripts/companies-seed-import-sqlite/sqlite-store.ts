// companies / company_profiles をローカル SQLite に保持する store。
// Node 同梱の node:sqlite (DatabaseSync) を使い、 追加依存ゼロ。
// 配列 (roles/tags/values/sources) は JSON テキスト、 真偽は 0/1 で持つ。
// upsert は normalized_name / company_id で冪等、 既存の非空値は温存・フラグは sticky(OR)。

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { CompanyFlags, CompanyProfileInput, NormalizedCompany } from '@tirocinium/companies';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  url             TEXT NOT NULL DEFAULT '',
  industry        TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  roles           TEXT NOT NULL DEFAULT '[]',
  tags            TEXT NOT NULL DEFAULT '[]',
  location        TEXT NOT NULL DEFAULT '',
  size            TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'unknown',
  source_url      TEXT NOT NULL DEFAULT '',
  is_newgrad      INTEGER NOT NULL DEFAULT 0,
  is_game         INTEGER NOT NULL DEFAULT 0,
  has_opening     INTEGER NOT NULL DEFAULT 0,
  recruit_url     TEXT NOT NULL DEFAULT '',
  stock_reason    TEXT NOT NULL DEFAULT '',
  crawled_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_companies_game ON companies(is_game);
CREATE INDEX IF NOT EXISTS idx_companies_opening ON companies(has_opening);

CREATE TABLE IF NOT EXISTS company_profiles (
  company_id   TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  philosophy   TEXT NOT NULL DEFAULT '',
  "values"     TEXT NOT NULL DEFAULT '[]',
  ir_summary   TEXT NOT NULL DEFAULT '',
  business     TEXT NOT NULL DEFAULT '',
  sources      TEXT NOT NULL DEFAULT '[]',
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const UPSERT_COMPANY = `
INSERT INTO companies
  (id, name, normalized_name, url, industry, description, roles, tags, location, size,
   source, source_url, is_newgrad, is_game, has_opening, recruit_url, stock_reason)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(normalized_name) DO UPDATE SET
  name         = excluded.name,
  url          = CASE WHEN excluded.url <> '' THEN excluded.url ELSE companies.url END,
  industry     = CASE WHEN excluded.industry <> '' THEN excluded.industry ELSE companies.industry END,
  description  = CASE WHEN excluded.description <> '' THEN excluded.description ELSE companies.description END,
  roles        = CASE WHEN excluded.roles <> '[]' THEN excluded.roles ELSE companies.roles END,
  tags         = CASE WHEN excluded.tags <> '[]' THEN excluded.tags ELSE companies.tags END,
  location     = CASE WHEN excluded.location <> '' THEN excluded.location ELSE companies.location END,
  size         = CASE WHEN excluded.size <> '' THEN excluded.size ELSE companies.size END,
  source       = excluded.source,
  source_url   = CASE WHEN excluded.source_url <> '' THEN excluded.source_url ELSE companies.source_url END,
  is_newgrad   = CASE WHEN companies.is_newgrad = 1 OR excluded.is_newgrad = 1 THEN 1 ELSE 0 END,
  is_game      = CASE WHEN companies.is_game = 1 OR excluded.is_game = 1 THEN 1 ELSE 0 END,
  has_opening  = CASE WHEN companies.has_opening = 1 OR excluded.has_opening = 1 THEN 1 ELSE 0 END,
  recruit_url  = CASE WHEN excluded.recruit_url <> '' THEN excluded.recruit_url ELSE companies.recruit_url END,
  stock_reason = CASE WHEN excluded.stock_reason <> '' THEN excluded.stock_reason ELSE companies.stock_reason END,
  updated_at   = datetime('now')
`;

const UPSERT_PROFILE = `
INSERT INTO company_profiles (company_id, philosophy, "values", ir_summary, business, sources)
VALUES (?,?,?,?,?,?)
ON CONFLICT(company_id) DO UPDATE SET
  philosophy = excluded.philosophy,
  "values"   = excluded."values",
  ir_summary = excluded.ir_summary,
  business   = excluded.business,
  sources    = excluded.sources,
  fetched_at = datetime('now')
`;

export type SqliteSignals = { flags: CompanyFlags; recruitUrl: string; stockReason: string };

/** SQLite を開き、 スキーマを冪等に用意する。 */
export function openCompaniesDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

const b = (v: boolean): number => (v ? 1 : 0);

/** 1 社を upsert し、 inserted/updated と id を返す (id は profile FK 用)。 */
export function upsertCompanySqlite(
  db: DatabaseSync,
  c: NormalizedCompany,
  s: SqliteSignals,
): { status: 'inserted' | 'updated'; id: string } {
  const existing = db.prepare('SELECT id FROM companies WHERE normalized_name = ?').get(c.normalized_name) as
    | { id: string }
    | undefined;
  const id = existing?.id ?? randomUUID();
  db.prepare(UPSERT_COMPANY).run(
    id,
    c.name,
    c.normalized_name,
    c.url,
    c.industry,
    c.description,
    JSON.stringify(c.roles),
    JSON.stringify(c.tags),
    c.location,
    c.size,
    c.source,
    c.source_url,
    b(s.flags.isNewgrad),
    b(s.flags.isGame),
    b(s.flags.hasOpening),
    s.recruitUrl,
    s.stockReason,
  );
  return { status: existing ? 'updated' : 'inserted', id };
}

/** 企業プロファイルを upsert する (companies と 1:1)。 */
export function upsertProfileSqlite(db: DatabaseSync, companyId: string, p: CompanyProfileInput): void {
  db.prepare(UPSERT_PROFILE).run(
    companyId,
    p.philosophy ?? '',
    JSON.stringify(p.values ?? []),
    p.ir_summary ?? '',
    p.business ?? '',
    JSON.stringify(p.sources ?? []),
  );
}
