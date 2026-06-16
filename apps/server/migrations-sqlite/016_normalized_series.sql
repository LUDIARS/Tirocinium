-- migration 016 (SQLite 方言): games.normalized_series (#202)
-- migrations/016_normalized_series.sql の SQLite 版。 INDEX は ADD COLUMN の後に発行する。

ALTER TABLE games ADD COLUMN normalized_series TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_games_normalized_series ON games(normalized_series) WHERE normalized_series <> '';
