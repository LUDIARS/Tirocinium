-- migration 010 (SQLite 方言): 技術スタック グラフ + プラットフォーム分類

CREATE TABLE IF NOT EXISTS tech (
  id              TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  category        TEXT NOT NULL DEFAULT '',
  crawled_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_tech (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tech_id     TEXT NOT NULL REFERENCES tech(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, tech_id)
);

ALTER TABLE companies ADD COLUMN is_social        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN primary_platform TEXT    NOT NULL DEFAULT '';
ALTER TABLE games ADD COLUMN platform_class TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tech_category ON tech(category) WHERE category <> '';
CREATE INDEX IF NOT EXISTS idx_company_tech_tech ON company_tech(tech_id);
CREATE INDEX IF NOT EXISTS idx_companies_social ON companies(is_social) WHERE is_social = 1;
CREATE INDEX IF NOT EXISTS idx_games_platform_class ON games(platform_class) WHERE platform_class <> '';
