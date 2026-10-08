-- spec/feature/companies/internship-webhook.md
-- 求人snapshotの削除・再作成から独立した通知台帳。秘密URLは保存しない。
CREATE TABLE IF NOT EXISTS job_news_webhook_deliveries (
  dedup_key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent', 'failed', 'unknown')),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_news_daily_runs (
  day_key TEXT PRIMARY KEY,
  started_at TEXT NOT NULL
);
