# schema — Tirocinium DB スキーマ

サーバーモードの **共通 DB** に持つテーブル。
個人データ (ES 本文 / 面接トランスクリプト) は **持たない** (Memoria に逃がす)。
ローカルモードはこの schema の subset を SQLite で持つ。

DB 系: **PostgreSQL** (LUDIARS 共通 infra 流用、port 5432)。

---

## テーブル一覧

| Table | 役割 |
|---|---|
| `sessions` | 面接セッションのメタ情報 |
| `session_turns` | 各 turn の {STT 結果、応答 ref、評価 snapshot} |
| `evaluations` | 終了後 / 中間のペルソナ評価集計 |
| `training_data_refs` | 教師データへの参照 (本体は Memoria) |
| `reservation_slots` | 30 分単位の予約枠 |
| `reservations` | ユーザの予約レコード |
| `users` | Cernere user_id mirror (FK 用、PII は持たない) |

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

```sql
CREATE TABLE training_data_refs (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('es','portfolio','past_qa','self_intro')),
  memoria_uri TEXT NOT NULL,          -- 本体は Memoria
  tags        TEXT[] NOT NULL DEFAULT '{}',
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding   VECTOR(1536)            -- pgvector
);

CREATE INDEX idx_tdr_user_kind ON training_data_refs(user_id, kind);
CREATE INDEX idx_tdr_embedding ON training_data_refs USING ivfflat (embedding vector_cosine_ops);
```

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

## ローカルモード差分

ローカル SQLite は以下のみ:

- `sessions` (mode='local')
- `session_turns` (text_uri は file:// パス)
- `evaluations`
- `training_data_refs` (memoria_uri は file:// パスでも可)

= `reservation_*` / `users` は持たない。
