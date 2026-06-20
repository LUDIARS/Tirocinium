-- 新卒採用者インタビュー記事のクロール保存 + 会社別「求める新卒像」サマリ。
-- spec/feature/companies/interview-articles.md。 公開記事の本文/要約のみ保持 (個人特定情報は持たない)。
-- 記事本文は他機能 (ES添削/面接質問の素材等) でも再利用するため raw を残す。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 006_*.sql 以降で追記する。

-- クロールしたインタビュー記事の保存 (再利用のため raw 本文を残す)
CREATE TABLE IF NOT EXISTS company_interview_articles (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  normalized_url TEXT NOT NULL,               -- dedup キー (hash/末尾スラッシュ除去)
  title          TEXT NOT NULL DEFAULT '',
  body           TEXT NOT NULL DEFAULT '',    -- htmlToText 抽出本文
  source         TEXT NOT NULL DEFAULT 'interview-crawl',
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, normalized_url)
);
CREATE INDEX IF NOT EXISTS idx_interview_articles_company ON company_interview_articles(company_id);

-- 会社が求める新卒像の要約 (上記記事群を集約)。 companies と 1:1。
CREATE TABLE IF NOT EXISTS company_newgrad_images (
  company_id    UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  summary       TEXT NOT NULL DEFAULT '',       -- 会社が求める新卒像の要約
  themes        JSONB NOT NULL DEFAULT '[]',    -- 頻出キーワード/価値観 string[]
  sources       JSONB NOT NULL DEFAULT '[]',    -- 要約に使った記事 URL string[]
  article_count INT NOT NULL DEFAULT 0,
  model         TEXT NOT NULL DEFAULT '',
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
