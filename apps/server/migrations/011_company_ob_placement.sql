-- OB 就職実績の集計 (spec/feature/companies/game-graph.md Phase 3 / §3.4)
-- 個人レコードは一切持たない ([[project_personal_data_rule]])。 保持は集計のみ:
--   {company_id, 入社年, クラス, 役職, 人数}。 データはユーザ付与 (クロールしない)。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 012_*.sql 以降で追記する。

CREATE TABLE IF NOT EXISTS company_ob_placement (
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  join_year    INTEGER NOT NULL DEFAULT 0,   -- 入社年 (0 = 不明)
  class_name   TEXT NOT NULL DEFAULT '',     -- クラス (例 'ゲームプランナー専攻 2024')
  role         TEXT NOT NULL DEFAULT '',     -- 役職/職種
  headcount    INTEGER NOT NULL DEFAULT 0,   -- 人数 (集計のみ・個人なし)
  source       TEXT NOT NULL DEFAULT 'user', -- 原則ユーザ付与
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, join_year, class_name, role)
);

-- INDEX は CREATE TABLE の後に発行 ([[feedback_sqlite_create_index_after_alter]])
CREATE INDEX IF NOT EXISTS idx_company_ob_company ON company_ob_placement(company_id);
CREATE INDEX IF NOT EXISTS idx_company_ob_year ON company_ob_placement(join_year) WHERE join_year > 0;
