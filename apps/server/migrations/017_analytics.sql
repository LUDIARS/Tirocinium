-- migration 017 (Postgres): ページアクセス解析ログ。
-- SQLite 版 (migrations-sqlite/017_analytics.sql) と同じ列。Postgres 用が欠けていたため追加した
-- (C++ サーバの /api/v1/analytics/* が Postgres で動くように。job cpp-node-20261030)。
-- IMMUTABLE: 適用済 SQL は書き換えず、変更は以降の番号で追記する。

CREATE TABLE IF NOT EXISTS analytics_events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type  TEXT NOT NULL,  -- 'page_view' | 'company_view'
  path        TEXT NOT NULL,
  entity_id   TEXT,
  entity_name TEXT,
  ip          TEXT,
  browser     TEXT,
  user_agent  TEXT,
  referrer    TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_ts   ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type, ts);
