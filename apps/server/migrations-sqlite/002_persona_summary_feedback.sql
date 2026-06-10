-- migration 002 (SQLite 方言): persona / summary / feedback / ft_loop_runs
-- migrations/002_persona_summary_feedback.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS interviewer_personas (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  stage           TEXT NOT NULL CHECK (stage IN ('hr','peer-tech','lead-tech','final')),
  role_lens       TEXT NOT NULL DEFAULT 'any',
  temperament     TEXT NOT NULL,
  pressure        INTEGER NOT NULL CHECK (pressure BETWEEN 1 AND 5),
  tics            TEXT NOT NULL DEFAULT '[]',
  bio             TEXT NOT NULL,
  evaluation_bias TEXT NOT NULL DEFAULT '{}',
  is_seed         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persona_stage_role ON interviewer_personas(stage, role_lens);

CREATE TABLE IF NOT EXISTS examinee_personas (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  background        TEXT NOT NULL,
  target_role       TEXT NOT NULL,
  weakness_axes     TEXT NOT NULL DEFAULT '{}',
  strengths         TEXT NOT NULL DEFAULT '[]',
  speech_style      TEXT NOT NULL,
  intentional_flaws TEXT NOT NULL DEFAULT '[]',
  bio               TEXT NOT NULL,
  is_seed           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_examinee_role ON examinee_personas(target_role);

CREATE TABLE IF NOT EXISTS interview_summaries (
  id               TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  session_id       TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  generated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  headline         TEXT NOT NULL,
  highlights       TEXT NOT NULL DEFAULT '[]',
  axes_summary     TEXT NOT NULL DEFAULT '{}',
  growth_points    TEXT NOT NULL DEFAULT '[]',
  carry_over       TEXT NOT NULL DEFAULT '[]',
  interviewer_note TEXT,
  model            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS human_feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id),
  target_kind  TEXT NOT NULL CHECK (target_kind IN
    ('summary_block','growth_hint','rag_ref','ai_critique','evaluation_axis')),
  target_id    TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('accept','reject','edit','skip')),
  edit_payload TEXT,
  reason       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hf_user_target ON human_feedback(user_id, target_kind, target_id);

CREATE TABLE IF NOT EXISTS ft_loop_runs (
  id                TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  interviewer_id    TEXT NOT NULL REFERENCES interviewer_personas(id),
  examinee_id       TEXT NOT NULL REFERENCES examinee_personas(id),
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at          TEXT,
  status            TEXT NOT NULL CHECK (status IN ('running','completed','aborted')),
  human_review_done INTEGER NOT NULL DEFAULT 0,
  metadata          TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ft_status ON ft_loop_runs(status, started_at);
