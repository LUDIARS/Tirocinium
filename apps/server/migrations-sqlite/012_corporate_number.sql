-- migration 012 (SQLite 方言): 法人番号 (corporate_number) を companies に追加
-- migrations/012_corporate_number.sql の SQLite 版。

ALTER TABLE companies ADD COLUMN corporate_number TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_companies_corp_number ON companies(corporate_number) WHERE corporate_number <> '';
