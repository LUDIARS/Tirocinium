-- 技術スタック グラフ + プラットフォーム分類 (spec/feature/companies/game-graph.md / tech レイヤー)
-- 企業↔技術 (engine/language/dcc/cloud/style) をグラフ化し、 ゲーム機種からソシャゲ分類する。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 011_*.sql 以降で追記する。

-- 技術ノード (Unity/Unreal/C#/C++/Maya/AWS/ハイグラ 等)
CREATE TABLE IF NOT EXISTS tech (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  category        TEXT NOT NULL DEFAULT '',  -- engine/language/dcc/cloud/style
  crawled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 企業 ↔ 技術
CREATE TABLE IF NOT EXISTS company_tech (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tech_id     UUID NOT NULL REFERENCES tech(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, tech_id)
);

-- 会社のプラットフォーム傾向 (ゲーム機種から集約)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_social        BOOLEAN NOT NULL DEFAULT false;  -- モバイル/ソーシャル中心
ALTER TABLE companies ADD COLUMN IF NOT EXISTS primary_platform TEXT    NOT NULL DEFAULT '';      -- mobile/console/pc/multi

-- ゲーム機種分類 (Wikidata P400 由来)
ALTER TABLE games ADD COLUMN IF NOT EXISTS platform_class TEXT NOT NULL DEFAULT '';  -- mobile/console/pc

CREATE INDEX IF NOT EXISTS idx_tech_category ON tech(category) WHERE category <> '';
CREATE INDEX IF NOT EXISTS idx_company_tech_tech ON company_tech(tech_id);
CREATE INDEX IF NOT EXISTS idx_companies_social ON companies(is_social) WHERE is_social;
CREATE INDEX IF NOT EXISTS idx_games_platform_class ON games(platform_class) WHERE platform_class <> '';
