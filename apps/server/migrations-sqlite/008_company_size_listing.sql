-- migration 008 (SQLite 方言): 会社規模 (従業員数) + 上場区分
-- migrations/008_company_size_listing.sql の SQLite 版。
-- SQLite の ALTER TABLE ADD COLUMN は 1 文 1 列。 INDEX は ADD COLUMN の後に発行。

ALTER TABLE companies ADD COLUMN employee_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN listing_market TEXT    NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_companies_employee ON companies(employee_count);
CREATE INDEX IF NOT EXISTS idx_companies_listing  ON companies(listing_market) WHERE listing_market <> '';
