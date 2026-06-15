-- migration 013 (SQLite 方言): ユーザ提供リンクの取得キャッシュ
-- migrations/013_link_cache.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS link_cache (
  url            TEXT PRIMARY KEY,
  normalized_url TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  content_text   TEXT NOT NULL DEFAULT '',
  fetched_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_link_cache_normalized ON link_cache(normalized_url) WHERE normalized_url <> '';
