-- migration 006 (SQLite 方言): 会社 × 役職 ごとの求める新卒像
-- migrations/006_newgrad_role_images.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS company_newgrad_role_images (
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  themes        TEXT NOT NULL DEFAULT '[]',
  article_count INTEGER NOT NULL DEFAULT 0,
  model         TEXT NOT NULL DEFAULT '',
  fetched_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, role)
);
CREATE INDEX IF NOT EXISTS idx_newgrad_role ON company_newgrad_role_images(role);
