-- migration 014 (SQLite 方言): 自動 enrich キューの進行カーソル
-- migrations/014_enrich_queue.sql の SQLite 版。

ALTER TABLE companies ADD COLUMN enrich_attempted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_enrich_cursor ON companies(enrich_attempted_at);
