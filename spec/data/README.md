# schema — Tirocinium DB スキーマ

サーバーモードの **共通 DB** に持つテーブル。
個人データ (ES 本文 / 面接トランスクリプト) は **持たない** (Memoria に逃がす)。
ローカルモードはこの schema の subset を SQLite で持つ。

DB 系: **SQLite (既定 / ローカル) ↔ PostgreSQL (server/共有)** の 2 バックエンド。
`DATABASE_URL` で切替 — `postgres://…` は PG、 空/`sqlite:`/`file:`/`*.sqlite` は SQLite (既定はローカル SQLite で docker/Postgres 不要)。
SQLite は `apps/server/src/db/sqlite-driver.ts` の **postgres 風互換 shim** (タグ付き `sql` / `sql.json` / `sql.unsafe` / `sql.begin` を node:sqlite 上で再実装) が吸収し、 既存リポは原則無改変。 方言は `now()→datetime('now')` / `::cast` 除去 / `FOR UPDATE` 除去 / `uuid_generate_v4`・`cardinality` をカスタム関数で移植。 schema は `migrations/`(PG) と `migrations-sqlite/`(SQLite) の二系統。

> SQLite 側の既知ギャップ: 予約系 (`reservation_*`) の `EXTRACT`/`date_trunc`/`interval` は未移植 (ローカルモードは予約を持たない設計のため許容)。 真偽値は 0/1 で返る (PG は boolean)。

---

## テーブル一覧

| Table | 役割 |
|---|---|
| `sessions` | 面接セッションのメタ情報 |
| `session_turns` | 各 turn の {STT 結果、応答 ref、評価 snapshot} |
| `evaluations` | 終了後 / 中間のペルソナ評価集計 |
| `training_data_refs` | 教師データへの参照 (本体 + embedding は Memoria) |
| `weakness_profiles` | user 単位の弱点プロファイル (Opus 評価の EMA 集約) |
| `interviewer_personas` | 面接官ペルソナ (§3.5) |
| `examinee_personas` | 受験者ペルソナ (テスト/FT loop 用、 §3.6) |
| `interview_summaries` | session 終了時の構造化サマリ (§3.7) |
| `human_feedback` | サマリ / hint / 教師データ参照に対する人間フィードバック (§3.8) |
| `ft_loop_runs` | FT-like loop の実行ログ (§3.9) |
| `reservation_slots` | 30 分単位の予約枠 |
| `reservations` | ユーザの予約レコード |
| `users` | Cernere user_id mirror (FK 用、PII は持たない) |
| `companies` | クロールで集めた企業プール (公開情報、§spec/companies) |
| `company_profiles` | 企業サイト巡回で得た IR/理念 (ES添削の背景 RAG、§spec/companies §3.5.3) |
| `company_recommendations` | ES から導出したおすすめ企業の結果履歴 (導出ガイダンス) |
| `company_interview_questions` | 会社別の面接質問プール (面接質問リストの優先素材、§spec/feature/companies/interview-questions) |

---

## sessions

```sql
CREATE TABLE sessions (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  mode          TEXT NOT NULL CHECK (mode IN ('local','server')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('active','ended','aborted','scheduled')),
  reservation_id UUID REFERENCES reservations(id),  -- 予約発の場合
  target_company TEXT,                              -- 志望先 tag
  target_role    TEXT,                              -- 職種 tag
  llm_profile   JSONB NOT NULL,                     -- {response: 'sonnet-x', deep: 'gpt-5.5', eval: 'opus-x'}
  metadata      JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_sessions_user ON sessions(user_id, started_at DESC);
CREATE INDEX idx_sessions_status ON sessions(status) WHERE status = 'active';
```

---

## session_turns

```sql
CREATE TABLE session_turns (
  id           BIGSERIAL PRIMARY KEY,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_no      INT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user','interviewer')),
  stt_text     TEXT,                  -- user turn のみ
  text_uri     TEXT NOT NULL,         -- 本文は Memoria に逃がす ({memoria}/turns/{id})
  started_at   TIMESTAMPTZ NOT NULL,
  duration_ms  INT,
  meta         JSONB DEFAULT '{}',    -- VAD info, barge_in flag, model used
  UNIQUE (session_id, turn_no)
);

CREATE INDEX idx_turns_session ON session_turns(session_id, turn_no);
```

---

## evaluations

```sql
CREATE TABLE evaluations (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_range    INT4RANGE NOT NULL,   -- 何 turn 目から何 turn 目を評価したか
  scored_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  axes          JSONB NOT NULL,       -- {consistency: 3, clarity: 4, demeanor: 2, ...} 0-5
  comment       TEXT,
  hints         JSONB DEFAULT '[]',   -- string[]
  model         TEXT NOT NULL         -- 'opus-x.y'
);

CREATE INDEX idx_eval_session ON evaluations(session_id, scored_at);
```

---

## training_data_refs

embedding 本体は **Memoria** 側で保持する (Memoria の RAG 基盤を流用)。
本テーブルは「Memoria のどの doc/embedding を参照しているか」 のメタだけ。

```sql
CREATE TABLE training_data_refs (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL CHECK (kind IN ('es','portfolio','past_qa','self_intro')),
  memoria_uri   TEXT NOT NULL,          -- 本文の URI
  embedding_id  TEXT,                   -- Memoria 側 embedding の id (vector search 引数)
  tags          TEXT[] NOT NULL DEFAULT '{}',
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tdr_user_kind ON training_data_refs(user_id, kind);
```

---

## weakness_profiles

user 単位の 「鍛えるべき軸」。 Opus 評価 (§3.3) のたびに EMA で更新。
session 開始時に Sonnet system prompt + GPT-5.5 補正の両方に食わせる。

```sql
CREATE TABLE weakness_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id),
  axes_ema       JSONB NOT NULL,        -- {consistency: 3.2, clarity: 2.4, ...} 6軸の指数移動平均
  axes_variance  JSONB NOT NULL,        -- 同上 分散 (安定度)
  weak_top3      TEXT[] NOT NULL,       -- 直近の弱軸 top3 (system prompt 注入用)
  hint_history   JSONB NOT NULL DEFAULT '[]',  -- 過去の改善 hint (重複回避用)
  session_count  INT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

更新ルール:

- EMA 係数 α = 0.3 (新しい評価を 30% 重みで反映)
- 6 軸の score を `axes_ema[axis] = α * new + (1-α) * old`
- `weak_top3` は `axes_ema` の昇順 top-3 を再計算
- `hint_history` は 直近 N=50 件まで FIFO で保持

---

## reservation_slots

30 分単位の枠を **未来分だけ** 作って管理する。

```sql
CREATE TABLE reservation_slots (
  slot_start  TIMESTAMPTZ PRIMARY KEY,    -- :00 か :30 の境界に正規化
  capacity    INT NOT NULL,               -- 同時面接可能数 (= LLM プール枠)
  used        INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (used >= 0 AND used <= capacity)
);
```

---

## reservations

```sql
CREATE TABLE reservations (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  slot_start    TIMESTAMPTZ NOT NULL REFERENCES reservation_slots(slot_start),
  status        TEXT NOT NULL CHECK (status IN ('held','started','no_show','canceled','completed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  notify_sent   BOOLEAN NOT NULL DEFAULT false,    -- 15 分前通知の冪等フラグ
  session_id    UUID REFERENCES sessions(id),
  UNIQUE (user_id, status) WHERE status IN ('held','started')  -- 同時 1 件まで
);

CREATE INDEX idx_resv_slot ON reservations(slot_start, status);
```

---

## users (Cernere mirror)

PII は **持たない**。FK のためだけの dummy 表。

```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY,         -- = Cernere user_id
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## interviewer_personas

```sql
CREATE TABLE interviewer_personas (
  id              TEXT PRIMARY KEY,           -- 'hr-warm-40f' 等
  display_name    TEXT NOT NULL,
  stage           TEXT NOT NULL CHECK (stage IN ('hr','peer-tech','lead-tech','final')),
  role_lens       TEXT NOT NULL DEFAULT 'any', -- 'planner'/'programmer'/'designer'/'sound'/'any'
  temperament     TEXT NOT NULL,               -- 'warm'/'neutral'/'strict'/'sharp'/'nurturing'
  pressure        SMALLINT NOT NULL CHECK (pressure BETWEEN 1 AND 5),
  tics            TEXT[] NOT NULL DEFAULT '{}',
  bio             TEXT NOT NULL,
  evaluation_bias JSONB NOT NULL DEFAULT '{}', -- {clarity: 1.2, demeanor: 0.9, ...}
  is_seed         BOOLEAN NOT NULL DEFAULT false,  -- LUDIARS 提供の seed か user 追加か
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_persona_stage_role ON interviewer_personas(stage, role_lens);
```

---

## examinee_personas

```sql
CREATE TABLE examinee_personas (
  id                 TEXT PRIMARY KEY,         -- 'examinee-newgrad-programmer-shy' 等
  display_name       TEXT NOT NULL,
  background         TEXT NOT NULL,            -- '大学新卒/独学2年/中途3年' 等
  target_role        TEXT NOT NULL,
  weakness_axes      JSONB NOT NULL DEFAULT '{}', -- {clarity: 3, depth_resilience: 4, ...}
  strengths          TEXT[] NOT NULL DEFAULT '{}',
  speech_style       TEXT NOT NULL,            -- 'formal'/'casual'/'nervous'/'verbose'
  intentional_flaws  TEXT[] NOT NULL DEFAULT '{}',
  bio                TEXT NOT NULL,
  is_seed            BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_examinee_role ON examinee_personas(target_role);
```

---

## interview_summaries

session 終了時の Opus 出力。 構造化された JSONB で保存。

```sql
CREATE TABLE interview_summaries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  headline        TEXT NOT NULL,
  highlights      JSONB NOT NULL DEFAULT '[]',    -- [{turn_no, comment}, ...]
  axes_summary    JSONB NOT NULL DEFAULT '{}',    -- {final: {axis: score}, ema_delta: {...}}
  growth_points   JSONB NOT NULL DEFAULT '[]',    -- string[]
  carry_over      JSONB NOT NULL DEFAULT '[]',    -- string[]
  interviewer_note TEXT,                          -- 面接官ペルソナの総評
  model           TEXT NOT NULL                   -- 'opus-x.y'
);
```

---

## human_feedback

サマリ / hint / 教師データに対する人間判断の履歴。 取消可能性のため append-only。

```sql
CREATE TABLE human_feedback (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  target_kind   TEXT NOT NULL CHECK (target_kind IN
    ('summary_block','growth_hint','rag_ref','ai_critique','evaluation_axis')),
  target_id     TEXT NOT NULL,                 -- summary id + block name / hint hash 等
  action        TEXT NOT NULL CHECK (action IN ('accept','reject','edit','skip')),
  edit_payload  JSONB,                         -- edit 時の差し替え値
  reason        TEXT,                          -- 任意の理由メモ
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hf_user_target ON human_feedback(user_id, target_kind, target_id);
```

---

## ft_loop_runs

FT-like loop (§3.9) の実行記録。 1 行 = 1 session run。

```sql
CREATE TABLE ft_loop_runs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interviewer_id      TEXT NOT NULL REFERENCES interviewer_personas(id),
  examinee_id         TEXT NOT NULL REFERENCES examinee_personas(id),
  session_id          UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ,
  status              TEXT NOT NULL CHECK (status IN ('running','completed','aborted')),
  human_review_done   BOOLEAN NOT NULL DEFAULT false,
  metadata            JSONB NOT NULL DEFAULT '{}'  -- critique model, turn count 等
);

CREATE INDEX idx_ft_status ON ft_loop_runs(status, started_at);
```

---

## companies (migration 003)

クロールで集めた企業の**公開情報**。 個人データではないため保持してよい。
`normalized_name` (lower + 法人格/記号除去) で dedup。

```sql
CREATE TABLE companies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  url             TEXT NOT NULL DEFAULT '',
  industry        TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  roles           TEXT[] NOT NULL DEFAULT '{}',  -- planner/programmer/designer/sound
  tags            TEXT[] NOT NULL DEFAULT '{}',
  location        TEXT NOT NULL DEFAULT '',
  size            TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'unknown',
  source_url      TEXT NOT NULL DEFAULT '',
  crawled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- migration 004 で追加: is_newgrad / is_game / has_opening / recruit_url / stock_reason
);
-- GIN(roles), GIN(tags), industry, partial(is_newgrad), partial(is_game)
```

upsert は空でない値だけ更新し、 クロール毎の劣化 (新規取得が薄い場合) を防ぐ。
発見フラグ (is_newgrad/is_game/has_opening) は OR でマージし、 一度立ったら温存する。

---

## company_profiles (migration 004)

企業サイト巡回で得た IR / 企業理念 等。 `companies` と 1:1。

```sql
CREATE TABLE company_profiles (
  company_id   UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  philosophy   TEXT NOT NULL DEFAULT '',
  values       JSONB NOT NULL DEFAULT '[]',  -- string[]
  ir_summary   TEXT NOT NULL DEFAULT '',
  business     TEXT NOT NULL DEFAULT '',
  sources      JSONB NOT NULL DEFAULT '[]',  -- 巡回 URL string[]
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## company_recommendations (migration 003)

ES から導出した **おすすめ企業の結果**。 ES 本文は持たず、 理由は要約で保持。

```sql
CREATE TABLE company_recommendations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  query         JSONB NOT NULL DEFAULT '{}',  -- {target_role, target_company, tags, weak_axes}
  method        TEXT NOT NULL CHECK (method IN ('llm','heuristic')),
  model         TEXT NOT NULL DEFAULT 'none',
  items         JSONB NOT NULL DEFAULT '[]'   -- [{company_id, name, score, reasons[], concerns[]}]
);
-- idx_company_reco_user (user_id, created_at DESC)
```

---

## ローカルモード差分

ローカル SQLite は以下のみ:

- `sessions` (mode='local')
- `session_turns` (text_uri は file:// パス)
- `evaluations`
- `training_data_refs` (memoria_uri は file:// パスでも可。 embedding はローカル sqlite-vec / Memoria local の検討)
- `weakness_profiles` (ローカルでも 1 行だけ持つ、 サーバーと同期はしない)

= `reservation_*` / `users` は持たない。
