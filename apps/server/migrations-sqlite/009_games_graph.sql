-- migration 009 (SQLite 方言): 企業×ゲーム グラフDB Phase 1
-- migrations/009_games_graph.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS games (
  id               TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  title            TEXT NOT NULL,
  normalized_title TEXT NOT NULL UNIQUE,
  series           TEXT NOT NULL DEFAULT '',
  platform         TEXT NOT NULL DEFAULT '',
  genre            TEXT NOT NULL DEFAULT '',
  release_year     INTEGER NOT NULL DEFAULT 0,
  source           TEXT NOT NULL DEFAULT '',
  source_url       TEXT NOT NULL DEFAULT '',
  sources          TEXT NOT NULL DEFAULT '[]',
  crawled_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_game (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, game_id, role)
);

CREATE TABLE IF NOT EXISTS company_partner (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  partner_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'partner',
  source      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, partner_id, kind),
  CHECK (company_id <> partner_id)
);

CREATE INDEX IF NOT EXISTS idx_games_series ON games(series) WHERE series <> '';
CREATE INDEX IF NOT EXISTS idx_company_game_game ON company_game(game_id);
CREATE INDEX IF NOT EXISTS idx_company_game_company ON company_game(company_id);
CREATE INDEX IF NOT EXISTS idx_company_partner_partner ON company_partner(partner_id);
