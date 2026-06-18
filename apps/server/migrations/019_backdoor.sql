-- 卒業生「裏口」: 自己投稿型エントリ + マジックリンク token。 spec/companies/backdoor.md。
-- 本人が同意して書く自己申告データ (harvest した PII ではない)。 Discord identity をアンカーにし、
-- Cernere ではなく Discord (Bot B) 認証で本人確認する (Discutere と同じ Cernere 非依存方針)。
-- 個人データ境界 §6: company_ob_placement(集計) とは別系統。 本人が編集/削除できる前提。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 020_*.sql 以降で追記する。

CREATE TABLE IF NOT EXISTS backdoor_alumni (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  discord_user_id      TEXT NOT NULL UNIQUE,         -- 投稿者アンカー (Discord user id)
  display_name         TEXT NOT NULL DEFAULT '',     -- 表示名 (本人指定)
  current_company      TEXT NOT NULL DEFAULT '',     -- 今どの企業にいるか (自由記述)
  current_company_id   UUID REFERENCES companies(id) ON DELETE SET NULL,  -- 社名解決できた場合のみ
  message_to_students  TEXT NOT NULL DEFAULT '',     -- 学生に向けたメッセージ
  message_to_industry  TEXT NOT NULL DEFAULT '',     -- 業界内にいる人に向けたメッセージ
  students_published   BOOLEAN NOT NULL DEFAULT FALSE, -- 本体(学生向け)に掲載するか
  industry_published   BOOLEAN NOT NULL DEFAULT FALSE, -- 裏口(業界向け)に掲載するか
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backdoor_alumni_students
  ON backdoor_alumni(students_published) WHERE students_published IS TRUE;
CREATE INDEX IF NOT EXISTS idx_backdoor_alumni_industry
  ON backdoor_alumni(industry_published) WHERE industry_published IS TRUE;

-- マジックリンク / セッション token。 kind='link' は Bot B が DM で配るワンタイム、
-- kind='session' は裏口 view が link を交換して得る短命セッション。 used_at で link の再利用を封じる。
CREATE TABLE IF NOT EXISTS backdoor_tokens (
  token            TEXT PRIMARY KEY,             -- 不可推測なランダム token
  kind             TEXT NOT NULL,                -- 'link' | 'session'
  discord_user_id  TEXT NOT NULL,
  display_name     TEXT NOT NULL DEFAULT '',
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,                  -- link を session に交換した時刻 (再利用防止)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backdoor_tokens_user ON backdoor_tokens(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_backdoor_tokens_expires ON backdoor_tokens(expires_at);
