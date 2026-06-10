-- migration 005 (SQLite 方言): インタビュー記事保存 + 求める新卒像サマリ
-- migrations/005_company_newgrad_image.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS company_interview_articles (
  id             TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL DEFAULT 'interview-crawl',
  fetched_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, normalized_url)
);
CREATE INDEX IF NOT EXISTS idx_interview_articles_company ON company_interview_articles(company_id);

CREATE TABLE IF NOT EXISTS company_newgrad_images (
  company_id    TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  summary       TEXT NOT NULL DEFAULT '',
  themes        TEXT NOT NULL DEFAULT '[]',
  sources       TEXT NOT NULL DEFAULT '[]',
  article_count INTEGER NOT NULL DEFAULT 0,
  model         TEXT NOT NULL DEFAULT '',
  fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
