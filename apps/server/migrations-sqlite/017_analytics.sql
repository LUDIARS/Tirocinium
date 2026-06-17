-- migration 017 (SQLite): ページアクセス解析ログ

CREATE TABLE IF NOT EXISTS analytics_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT    NOT NULL DEFAULT (datetime('now')),
  event_type TEXT    NOT NULL,  -- 'page_view' | 'company_view'
  path       TEXT    NOT NULL,  -- '/companies', '/map', etc.
  entity_id  TEXT,              -- company id (company_view のみ)
  entity_name TEXT,             -- company name (company_view のみ)
  ip         TEXT,
  browser    TEXT,              -- UA から抽出したブラウザ名
  user_agent TEXT,
  referrer   TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_ts   ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type, ts);
