-- migration 007 (SQLite 方言): 横断 provenance + 中小レーン
-- migrations/007_company_sources_smb.sql の SQLite 版。
-- SQLite の ALTER TABLE ADD COLUMN は 1 文 1 列。 INDEX は ADD COLUMN の後に発行。

ALTER TABLE companies ADD COLUMN sources    TEXT    NOT NULL DEFAULT '[]';
ALTER TABLE companies ADD COLUMN is_smb     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN is_listed  INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_companies_smb ON companies(is_smb) WHERE is_smb = 1;
