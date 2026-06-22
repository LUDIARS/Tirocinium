-- migration 020 (SQLite 方言): OB求人投稿 + ES添削相談リクエスト
-- migrations/020_ob_job_postings.sql の SQLite 版。

-- OB が投稿する求人。 posted_by_discord_user_id は内部管理のみ (在校生向け API には返さない)。
CREATE TABLE IF NOT EXISTS ob_job_postings (
  id                        TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  posted_by_discord_user_id TEXT NOT NULL,
  title                     TEXT NOT NULL DEFAULT '',
  role                      TEXT NOT NULL DEFAULT '',
  description               TEXT NOT NULL DEFAULT '',
  company_name              TEXT NOT NULL DEFAULT '',
  company_id                TEXT REFERENCES companies(id) ON DELETE SET NULL,
  location                  TEXT NOT NULL DEFAULT '',
  employment_type           TEXT NOT NULL DEFAULT '',
  deadline                  TEXT NOT NULL DEFAULT '',
  is_active                 INTEGER NOT NULL DEFAULT 1,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ob_job_postings_poster  ON ob_job_postings(posted_by_discord_user_id);
CREATE INDEX IF NOT EXISTS idx_ob_job_postings_active  ON ob_job_postings(is_active) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_ob_job_postings_company ON ob_job_postings(company_id);

-- 在校生の ES 添削相談リクエスト。 ES 本文は Discord 内のみでやり取りし、このテーブルには保存しない。
-- 在校生は Cernere (本体認証) でリクエストを作成する。 student_discord_handle は OB が DM するための任意入力。
-- OB の引き受けは Discord Bot B 経由 (matched_ob_discord_user_id はその Discord ID)。
CREATE TABLE IF NOT EXISTS ob_es_requests (
  id                         TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  student_cernere_user_id    TEXT NOT NULL,
  student_display_name       TEXT NOT NULL DEFAULT '',
  student_discord_handle     TEXT NOT NULL DEFAULT '',   -- 任意: OB が DM するための Discord ハンドル
  target_company_name        TEXT NOT NULL DEFAULT '',
  target_company_id          TEXT REFERENCES companies(id) ON DELETE SET NULL,
  status                     TEXT NOT NULL DEFAULT 'pending',  -- pending / matched / closed
  matched_ob_discord_user_id TEXT,
  matched_ob_display_name    TEXT,
  request_note               TEXT NOT NULL DEFAULT '',
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ob_es_requests_student ON ob_es_requests(student_cernere_user_id);
CREATE INDEX IF NOT EXISTS idx_ob_es_requests_company ON ob_es_requests(target_company_id);
CREATE INDEX IF NOT EXISTS idx_ob_es_requests_status  ON ob_es_requests(status);
