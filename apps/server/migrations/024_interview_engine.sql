-- migration 024: 面接官再現エンジン P2 (spec/feature/inference/interviewer-reproduction.md §5/§6)
-- interview_briefs (面接ブリーフ md 正本) / company_interview_questions (企業別質問プール、
-- spec 前提だが未作成だったテーブル) / ob_question_patterns (OB 質問パターンの器。
-- 抽出バッチは P3) / evaluations.method (監査: llm/stub)。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 025_*.sql 以降で追記する。

-- 面接ブリーフ: セッション前にコンパイルし、セッション中は不変 (再現性の入力を 1 点に固定)
CREATE TABLE IF NOT EXISTS interview_briefs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  body_md     TEXT NOT NULL,
  -- 使った newgrad image / 質問プール id / Memoria ref / snapshot 日時 / 充足判定
  source_meta JSONB NOT NULL DEFAULT '{}',
  seed        BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 企業別質問プール (実企業の過去問。質問プランの最優先供給源)
CREATE TABLE IF NOT EXISTS company_interview_questions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL DEFAULT '',            -- hr/peer-tech/lead-tech/final ('' = 不明)
  role        TEXT NOT NULL DEFAULT 'general',     -- general/planner/programmer/designer/sound
  theme       TEXT NOT NULL DEFAULT '',
  question    TEXT NOT NULL,
  followups   JSONB NOT NULL DEFAULT '[]',         -- string[]
  axes        JSONB NOT NULL DEFAULT '[]',         -- AxisKey[]
  source_url  TEXT NOT NULL DEFAULT '',            -- 出所 (interview article 等)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ciq_company ON company_interview_questions(company_id, role);

-- OB コーパス由来の質問パターン (質問の型のみ。回答本文は持たない = 個人情報を含まない)
CREATE TABLE IF NOT EXISTS ob_question_patterns (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID REFERENCES companies(id) ON DELETE CASCADE,
  stage             TEXT NOT NULL DEFAULT '',
  role              TEXT NOT NULL DEFAULT 'general',
  theme             TEXT NOT NULL DEFAULT '',
  question_pattern  TEXT NOT NULL,
  followup_patterns JSONB NOT NULL DEFAULT '[]',   -- string[]
  axes              JSONB NOT NULL DEFAULT '[]',   -- AxisKey[]
  source_refs       JSONB NOT NULL DEFAULT '[]',   -- Memoria URI string[]
  contributor_alias TEXT NOT NULL DEFAULT '',      -- OB#xxxx (仮名化 serializer 由来)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_obqp_company ON ob_question_patterns(company_id, role);

-- 評価の監査可能性 (spec §7 表 6): 評価が llm か stub かを記録
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'llm';
