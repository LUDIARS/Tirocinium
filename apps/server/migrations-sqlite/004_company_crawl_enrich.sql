-- migration 004 (SQLite 方言): 発見シグナル列 + enrichment profile
-- migrations/004_company_crawl_enrich.sql の SQLite 版。
-- SQLite の ALTER TABLE ADD COLUMN は 1 文 1 列。 INDEX は ADD COLUMN の後に発行。

ALTER TABLE companies ADD COLUMN is_newgrad   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN is_game      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN has_opening  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN recruit_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN stock_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_companies_newgrad ON companies(is_newgrad) WHERE is_newgrad = 1;
CREATE INDEX IF NOT EXISTS idx_companies_game ON companies(is_game) WHERE is_game = 1;

CREATE TABLE IF NOT EXISTS company_profiles (
  company_id   TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  philosophy   TEXT NOT NULL DEFAULT '',
  "values"     TEXT NOT NULL DEFAULT '[]',
  ir_summary   TEXT NOT NULL DEFAULT '',
  business     TEXT NOT NULL DEFAULT '',
  sources      TEXT NOT NULL DEFAULT '[]',
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
