-- migration 022 (SQLite 方言): 企業クロールキュー (crawl_jobs) の永続化
-- migrations/022_crawl_jobs.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id           TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  url          TEXT NOT NULL,
  name_hint    TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'manual',
  status       TEXT NOT NULL DEFAULT 'queued',
  max_pages    INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  summary      TEXT NOT NULL DEFAULT '',
  error        TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL DEFAULT '',
  enqueued_at  TEXT NOT NULL DEFAULT (datetime('now')),
  started_at   TEXT,
  finished_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_enqueued ON crawl_jobs(enqueued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crawl_jobs_active_url
  ON crawl_jobs(url) WHERE status IN ('queued', 'running');
