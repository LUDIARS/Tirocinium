-- Tirocinium initial schema
-- DESIGN.md §6 / spec/data/README.md 準拠
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 002_*.sql 以降で追記する

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Cernere user mirror (PII 持たない)
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 30 分 slot
CREATE TABLE IF NOT EXISTS reservation_slots (
  slot_start  TIMESTAMPTZ PRIMARY KEY,
  capacity    INT NOT NULL,
  used        INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (used >= 0 AND used <= capacity)
);

-- 予約
CREATE TABLE IF NOT EXISTS reservations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id),
  slot_start    TIMESTAMPTZ NOT NULL REFERENCES reservation_slots(slot_start),
  status        TEXT NOT NULL CHECK (status IN ('held','started','no_show','canceled','completed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  notify_sent   BOOLEAN NOT NULL DEFAULT false,
  session_id    UUID
);

-- 同時 1 件まで (held/started のみ)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_resv_user_active
  ON reservations(user_id)
  WHERE status IN ('held','started');

CREATE INDEX IF NOT EXISTS idx_resv_slot ON reservations(slot_start, status);

-- 面接セッション
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  mode            TEXT NOT NULL CHECK (mode IN ('local','server')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  status          TEXT NOT NULL CHECK (status IN ('active','ended','aborted','scheduled')),
  reservation_id  UUID REFERENCES reservations(id),
  target_company  TEXT,
  target_role     TEXT,
  llm_profile     JSONB NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(status) WHERE status = 'active';

-- session turns
CREATE TABLE IF NOT EXISTS session_turns (
  id           BIGSERIAL PRIMARY KEY,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_no      INT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','interviewer')),
  stt_text     TEXT,
  text_uri     TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  duration_ms  INT,
  meta         JSONB NOT NULL DEFAULT '{}',
  UNIQUE (session_id, turn_no)
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON session_turns(session_id, turn_no);

-- 評価
CREATE TABLE IF NOT EXISTS evaluations (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_range    INT4RANGE NOT NULL,
  scored_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  axes          JSONB NOT NULL,
  comment       TEXT,
  hints         JSONB NOT NULL DEFAULT '[]',
  model         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_session ON evaluations(session_id, scored_at);

-- 教師データ参照 (本体 + embedding は Memoria)
CREATE TABLE IF NOT EXISTS training_data_refs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL CHECK (kind IN ('es','portfolio','past_qa','self_intro')),
  memoria_uri   TEXT NOT NULL,
  embedding_id  TEXT,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tdr_user_kind ON training_data_refs(user_id, kind);

-- 弱点プロファイル (本人学習の集約結果)
CREATE TABLE IF NOT EXISTS weakness_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id),
  axes_ema       JSONB NOT NULL DEFAULT '{}',
  axes_variance  JSONB NOT NULL DEFAULT '{}',
  weak_top3      TEXT[] NOT NULL DEFAULT '{}',
  hint_history   JSONB NOT NULL DEFAULT '[]',
  session_count  INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
