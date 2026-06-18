-- 求人ニュース (job postings) の永続化。 spec/companies/job-news.md。
-- ニュースフィード(rss) と 求人一覧ページ(job-listing) を 1 テーブルに畳む。 dedup_key で冪等。
-- 公開求人情報のみ保持 (個人データ境界 §6 対象外)。 新着判定 = INSERT 時の dedup_key 競合有無。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 019_*.sql 以降で追記する。

CREATE TABLE IF NOT EXISTS job_postings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          TEXT NOT NULL,                 -- news-sources.json の source id
  kind            TEXT NOT NULL DEFAULT 'rss',   -- 'rss' | 'job-listing'
  dedup_key       TEXT NOT NULL UNIQUE,          -- 冪等キー (normalizeUrl(url) 等)
  url             TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  company_name    TEXT NOT NULL DEFAULT '',
  company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,  -- 社名解決できた場合のみ
  role            TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT '',
  snippet         TEXT NOT NULL DEFAULT '',
  posted_at       TEXT NOT NULL DEFAULT '',      -- 公開日時 ISO (rss pubDate 等)
  deadline        TEXT NOT NULL DEFAULT '',
  notified        BOOLEAN NOT NULL DEFAULT FALSE, -- Nuntius 通知済みか
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_postings_seen ON job_postings(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_postings_source ON job_postings(source);
CREATE INDEX IF NOT EXISTS idx_job_postings_notified ON job_postings(notified) WHERE notified IS FALSE;
