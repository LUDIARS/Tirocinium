-- Tirocinium initial schema (SQLite 方言)。 migrations/001_init.sql の SQLite 版。
-- UUID→TEXT / TIMESTAMPTZ→TEXT / JSONB,TEXT[]→TEXT(JSON) / BIGSERIAL→INTEGER AUTOINCREMENT /
-- BOOLEAN→INTEGER(0/1)。 uuid_generate_v4() は sqlite-driver の登録関数。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 002_*.sql 以降で追記する。

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  first_seen  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservation_slots (
  slot_start  TEXT PRIMARY KEY,
  capacity    INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (used >= 0 AND used <= capacity)
);

CREATE TABLE IF NOT EXISTS reservations (
  id            TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  user_id       TEXT NOT NULL REFERENCES users(id),
  slot_start    TEXT NOT NULL REFERENCES reservation_slots(slot_start),
  status        TEXT NOT NULL CHECK (status IN ('held','started','no_show','canceled','completed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  notify_sent   INTEGER NOT NULL DEFAULT 0,
  session_id    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_resv_user_active
  ON reservations(user_id)
  WHERE status IN ('held','started');

CREATE INDEX IF NOT EXISTS idx_resv_slot ON reservations(slot_start, status);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  user_id         TEXT NOT NULL REFERENCES users(id),
  mode            TEXT NOT NULL CHECK (mode IN ('local','server')),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  status          TEXT NOT NULL CHECK (status IN ('active','ended','aborted','scheduled')),
  reservation_id  TEXT REFERENCES reservations(id),
  target_company  TEXT,
  target_role     TEXT,
  llm_profile     TEXT NOT NULL DEFAULT '{}',
  metadata        TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS session_turns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_no      INTEGER NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','interviewer')),
  stt_text     TEXT,
  text_uri     TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  duration_ms  INTEGER,
  meta         TEXT NOT NULL DEFAULT '{}',
  UNIQUE (session_id, turn_no)
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON session_turns(session_id, turn_no);

CREATE TABLE IF NOT EXISTS evaluations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_range    TEXT NOT NULL,
  scored_at     TEXT NOT NULL DEFAULT (datetime('now')),
  axes          TEXT NOT NULL,
  comment       TEXT,
  hints         TEXT NOT NULL DEFAULT '[]',
  model         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_session ON evaluations(session_id, scored_at);

CREATE TABLE IF NOT EXISTS training_data_refs (
  id            TEXT PRIMARY KEY DEFAULT (uuid_generate_v4()),
  user_id       TEXT NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL CHECK (kind IN ('es','portfolio','past_qa','self_intro')),
  memoria_uri   TEXT NOT NULL,
  embedding_id  TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  added_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tdr_user_kind ON training_data_refs(user_id, kind);

CREATE TABLE IF NOT EXISTS weakness_profiles (
  user_id        TEXT PRIMARY KEY REFERENCES users(id),
  axes_ema       TEXT NOT NULL DEFAULT '{}',
  axes_variance  TEXT NOT NULL DEFAULT '{}',
  weak_top3      TEXT NOT NULL DEFAULT '[]',
  hint_history   TEXT NOT NULL DEFAULT '[]',
  session_count  INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
