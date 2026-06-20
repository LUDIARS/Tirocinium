-- 企業×ゲーム グラフDB Phase 1 (spec/feature/companies/game-graph.md §3)
-- ゲームノード + 企業↔ゲーム edge + 企業↔企業 取引 edge。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 010_*.sql 以降で追記する。

CREATE TABLE IF NOT EXISTS games (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            TEXT NOT NULL,
  normalized_title TEXT NOT NULL UNIQUE,          -- dedup キー (記号/版表記/全角半角除去)
  series           TEXT NOT NULL DEFAULT '',      -- 例 'ファイナルファンタジー'
  platform         TEXT NOT NULL DEFAULT '',
  genre            TEXT NOT NULL DEFAULT '',
  release_year     INTEGER NOT NULL DEFAULT 0,    -- 0 = 不明
  source           TEXT NOT NULL DEFAULT '',
  source_url       TEXT NOT NULL DEFAULT '',
  sources          JSONB NOT NULL DEFAULT '[]',   -- 出所累積 [{source,url}]
  crawled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 企業 ↔ ゲーム (developer / publisher / credited / support)
CREATE TABLE IF NOT EXISTS company_game (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, game_id, role)
);

-- 企業 ↔ 企業 (主要取引先)
CREATE TABLE IF NOT EXISTS company_partner (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  partner_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'partner',   -- client / vendor / partner
  source      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, partner_id, kind),
  CHECK (company_id <> partner_id)
);

-- INDEX は CREATE TABLE の後に発行
CREATE INDEX IF NOT EXISTS idx_games_series ON games(series) WHERE series <> '';
CREATE INDEX IF NOT EXISTS idx_company_game_game ON company_game(game_id);
CREATE INDEX IF NOT EXISTS idx_company_game_company ON company_game(company_id);
CREATE INDEX IF NOT EXISTS idx_company_partner_partner ON company_partner(partner_id);
