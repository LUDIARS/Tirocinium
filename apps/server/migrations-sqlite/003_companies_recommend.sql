-- migration 003 (SQLite 方言): 企業プール + ES おすすめ企業
-- migrations/003_companies_recommend.sql の SQLite 版。 TEXT[]→TEXT(JSON) / GIN は通常 index 省略。

CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
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
  crawled_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);

CREATE TABLE IF NOT EXISTS company_recommendations (
  id            TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  query         TEXT NOT NULL DEFAULT '{}',
  method        TEXT NOT NULL CHECK (method IN ('llm','heuristic')),
  model         TEXT NOT NULL DEFAULT 'none',
  items         TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_company_reco_user ON company_recommendations(user_id, created_at DESC);
