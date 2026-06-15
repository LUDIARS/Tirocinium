-- migration 011 (SQLite 方言): OB 就職実績の集計 (個人なし)
-- migrations/011_company_ob_placement.sql の SQLite 版。

CREATE TABLE IF NOT EXISTS company_ob_placement (
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  join_year    INTEGER NOT NULL DEFAULT 0,
  class_name   TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT '',
  headcount    INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'user',
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, join_year, class_name, role)
);

CREATE INDEX IF NOT EXISTS idx_company_ob_company ON company_ob_placement(company_id);
CREATE INDEX IF NOT EXISTS idx_company_ob_year ON company_ob_placement(join_year) WHERE join_year > 0;
