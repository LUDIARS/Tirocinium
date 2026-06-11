-- 会社 × 役職 ごとの「求める新卒像」サマリ (テーブル化)。
-- company_newgrad_images (1社1像) を職種粒度に拡張。 role='general' が会社全体像。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 007_*.sql 以降で追記する。

CREATE TABLE IF NOT EXISTS company_newgrad_role_images (
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,                  -- general/planner/programmer/designer/sound
  summary       TEXT NOT NULL DEFAULT '',
  themes        JSONB NOT NULL DEFAULT '[]',
  article_count INT NOT NULL DEFAULT 0,
  model         TEXT NOT NULL DEFAULT '',
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, role)
);
CREATE INDEX IF NOT EXISTS idx_newgrad_role ON company_newgrad_role_images(role);
