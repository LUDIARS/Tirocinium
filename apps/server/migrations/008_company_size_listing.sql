-- 会社規模 (従業員数) + 上場区分 (spec/feature/companies/listing-bundle.md §2③ の精緻化)
-- 会社規模 = 従業員数 (employee_count、 0 = 不明 → 中小扱い)。
-- 上場は市場区分タグ (listing_market: prime=一部/プライム, growth=マザーズ/グロース, standard=二部/スタンダード, other=上場・市場不明, ''=非上場・不明)。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 009_*.sql 以降で追記する。

ALTER TABLE companies ADD COLUMN IF NOT EXISTS employee_count INTEGER NOT NULL DEFAULT 0;   -- 0 = 不明
ALTER TABLE companies ADD COLUMN IF NOT EXISTS listing_market TEXT    NOT NULL DEFAULT '';   -- prime/growth/standard/other / ''=非上場・不明

CREATE INDEX IF NOT EXISTS idx_companies_employee ON companies(employee_count);
CREATE INDEX IF NOT EXISTS idx_companies_listing  ON companies(listing_market) WHERE listing_market <> '';
