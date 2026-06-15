-- migration 015 (SQLite 方言): ジオコーディングキャッシュ
-- migrations/015_geocode_cache.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS geocode_cache (
  location     TEXT PRIMARY KEY,
  lat          REAL NOT NULL DEFAULT 0,
  lng          REAL NOT NULL DEFAULT 0,
  ok           INTEGER NOT NULL DEFAULT 0,
  geocoded_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
