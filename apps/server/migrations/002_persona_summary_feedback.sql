-- Tirocinium migration 002: persona / summary / feedback / ft_loop_runs
-- DESIGN.md §3.5-3.9 / spec/schema/README.md 準拠
-- IMMUTABLE: 既適用の SQL は書き換えず、 変更は 003_*.sql 以降に追記する

-- interviewer personas (§3.5)
CREATE TABLE IF NOT EXISTS interviewer_personas (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  stage           TEXT NOT NULL CHECK (stage IN ('hr','peer-tech','lead-tech','final')),
  role_lens       TEXT NOT NULL DEFAULT 'any',
  temperament     TEXT NOT NULL,
  pressure        SMALLINT NOT NULL CHECK (pressure BETWEEN 1 AND 5),
  tics            TEXT[] NOT NULL DEFAULT '{}',
  bio             TEXT NOT NULL,
  evaluation_bias JSONB NOT NULL DEFAULT '{}',
  is_seed         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_persona_stage_role ON interviewer_personas(stage, role_lens);

-- examinee personas (§3.6, テスト/FT loop 用)
CREATE TABLE IF NOT EXISTS examinee_personas (
  id                TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  background        TEXT NOT NULL,
  target_role       TEXT NOT NULL,
  weakness_axes     JSONB NOT NULL DEFAULT '{}',
  strengths         TEXT[] NOT NULL DEFAULT '{}',
  speech_style      TEXT NOT NULL,
  intentional_flaws TEXT[] NOT NULL DEFAULT '{}',
  bio               TEXT NOT NULL,
  is_seed           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_examinee_role ON examinee_personas(target_role);

-- interview summaries (§3.7)
CREATE TABLE IF NOT EXISTS interview_summaries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id       UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  headline         TEXT NOT NULL,
  highlights       JSONB NOT NULL DEFAULT '[]',
  axes_summary     JSONB NOT NULL DEFAULT '{}',
  growth_points    JSONB NOT NULL DEFAULT '[]',
  carry_over       JSONB NOT NULL DEFAULT '[]',
  interviewer_note TEXT,
  model            TEXT NOT NULL
);

-- human feedback (§3.8, append-only)
CREATE TABLE IF NOT EXISTS human_feedback (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id),
  target_kind  TEXT NOT NULL CHECK (target_kind IN
    ('summary_block','growth_hint','rag_ref','ai_critique','evaluation_axis')),
  target_id    TEXT NOT NULL,
  action       TEXT NOT NULL CHECK (action IN ('accept','reject','edit','skip')),
  edit_payload JSONB,
  reason       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hf_user_target ON human_feedback(user_id, target_kind, target_id);

-- FT-like loop runs (§3.9)
CREATE TABLE IF NOT EXISTS ft_loop_runs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interviewer_id    TEXT NOT NULL REFERENCES interviewer_personas(id),
  examinee_id       TEXT NOT NULL REFERENCES examinee_personas(id),
  session_id        UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  status            TEXT NOT NULL CHECK (status IN ('running','completed','aborted')),
  human_review_done BOOLEAN NOT NULL DEFAULT false,
  metadata          JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ft_status ON ft_loop_runs(status, started_at);
