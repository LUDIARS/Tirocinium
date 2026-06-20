-- migration 019 (SQLite 方言): 卒業生「裏口」エントリ + マジックリンク token
-- migrations/019_backdoor.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS backdoor_alumni (
  id                   TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  discord_user_id      TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL DEFAULT '',
  current_company      TEXT NOT NULL DEFAULT '',
  current_company_id   TEXT REFERENCES companies(id) ON DELETE SET NULL,
  message_to_students  TEXT NOT NULL DEFAULT '',
  message_to_industry  TEXT NOT NULL DEFAULT '',
  students_published   INTEGER NOT NULL DEFAULT 0,
  industry_published   INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backdoor_alumni_students
  ON backdoor_alumni(students_published) WHERE students_published = 1;
CREATE INDEX IF NOT EXISTS idx_backdoor_alumni_industry
  ON backdoor_alumni(industry_published) WHERE industry_published = 1;

CREATE TABLE IF NOT EXISTS backdoor_tokens (
  token            TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  discord_user_id  TEXT NOT NULL,
  display_name     TEXT NOT NULL DEFAULT '',
  expires_at       TEXT NOT NULL,
  used_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backdoor_tokens_user ON backdoor_tokens(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_backdoor_tokens_expires ON backdoor_tokens(expires_at);
