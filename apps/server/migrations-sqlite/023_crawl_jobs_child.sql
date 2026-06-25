-- migration 023 (SQLite 方言): crawl_jobs の子クローラ連鎖 追跡列
-- migrations/023_crawl_jobs_child.sql の SQLite 版。

ALTER TABLE crawl_jobs ADD COLUMN child_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE crawl_jobs ADD COLUMN child_log    TEXT NOT NULL DEFAULT '';
ALTER TABLE crawl_jobs ADD COLUMN child_detail TEXT NOT NULL DEFAULT '';
