-- migration 018 (SQLite 方言): 求人ニュース (job postings) の永続化
-- migrations/018_job_postings.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS job_postings (
  id              TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  source          TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'rss',
  dedup_key       TEXT NOT NULL UNIQUE,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  company_name    TEXT NOT NULL DEFAULT '',
  company_id      TEXT REFERENCES companies(id) ON DELETE SET NULL,
  role            TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT '',
  snippet         TEXT NOT NULL DEFAULT '',
  posted_at       TEXT NOT NULL DEFAULT '',
  deadline        TEXT NOT NULL DEFAULT '',
  notified        INTEGER NOT NULL DEFAULT 0,
  first_seen_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_job_postings_seen ON job_postings(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_postings_source ON job_postings(source);
CREATE INDEX IF NOT EXISTS idx_job_postings_notified ON job_postings(notified) WHERE notified = 0;
