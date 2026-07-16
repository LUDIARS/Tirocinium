-- migration 024 (SQLite 方言): 面接官再現エンジン P2。
-- migrations/024_interview_engine.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS interview_briefs (
  id          TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  session_id  TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  body_md     TEXT NOT NULL,
  source_meta TEXT NOT NULL DEFAULT '{}',
  seed        INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_interview_questions (
  id          TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'general',
  theme       TEXT NOT NULL DEFAULT '',
  question    TEXT NOT NULL,
  followups   TEXT NOT NULL DEFAULT '[]',
  axes        TEXT NOT NULL DEFAULT '[]',
  source_url  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ciq_company ON company_interview_questions(company_id, role);

CREATE TABLE IF NOT EXISTS ob_question_patterns (
  id                TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  company_id        TEXT REFERENCES companies(id) ON DELETE CASCADE,
  stage             TEXT NOT NULL DEFAULT '',
  role              TEXT NOT NULL DEFAULT 'general',
  theme             TEXT NOT NULL DEFAULT '',
  question_pattern  TEXT NOT NULL,
  followup_patterns TEXT NOT NULL DEFAULT '[]',
  axes              TEXT NOT NULL DEFAULT '[]',
  source_refs       TEXT NOT NULL DEFAULT '[]',
  contributor_alias TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_obqp_company ON ob_question_patterns(company_id, role);

-- SQLite は ADD COLUMN IF NOT EXISTS 非対応。migration runner が適用済みを管理するため素の ADD COLUMN でよい。
ALTER TABLE evaluations ADD COLUMN method TEXT NOT NULL DEFAULT 'llm';
