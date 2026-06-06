-- 企業クローラー: 新卒/ゲーム企業の発見 (listing) + 企業サイト巡回 (IR/理念) の格納
-- spec/companies/README.md。 companies は公開情報のため保持可 (DESIGN §6)。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 005_*.sql 以降で追記する。

-- 既存 companies に発見シグナル列を追加 (ALTER → その後に INDEX)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_newgrad   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_game      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS has_opening  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS recruit_url  TEXT NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stock_reason TEXT NOT NULL DEFAULT '';

-- 新規カラム用 INDEX は ALTER の後に発行 (既存 DB での "no such column" 回避)
CREATE INDEX IF NOT EXISTS idx_companies_newgrad ON companies(is_newgrad) WHERE is_newgrad;
CREATE INDEX IF NOT EXISTS idx_companies_game ON companies(is_game) WHERE is_game;

-- 企業サイト巡回で得た profile (IR / 理念 等)。 companies と 1:1。
CREATE TABLE IF NOT EXISTS company_profiles (
  company_id   UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  philosophy   TEXT NOT NULL DEFAULT '',
  values       JSONB NOT NULL DEFAULT '[]',   -- string[]
  ir_summary   TEXT NOT NULL DEFAULT '',
  business     TEXT NOT NULL DEFAULT '',
  sources      JSONB NOT NULL DEFAULT '[]',   -- 巡回した URL string[]
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
