-- 横断 provenance + 中小レーン (spec/feature/companies/listing-bundle.md)
-- 複数ソースの出所累積 (sources) と 中小/上場シグナル (is_smb / is_listed) を companies に追加。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 008_*.sql 以降で追記する。

-- 新規カラム (ALTER → その後に INDEX)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sources    JSONB   NOT NULL DEFAULT '[]';  -- [{source,url}]
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_smb     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_listed  BOOLEAN NOT NULL DEFAULT false;

-- 新規カラム用 INDEX は ALTER の後に発行 (既存 DB での "no such column" 回避)
CREATE INDEX IF NOT EXISTS idx_companies_smb ON companies(is_smb) WHERE is_smb;
