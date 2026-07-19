-- migration 025: 突合レビュー対応 (Tirocinium 面接エンジン P1-P3, Memoria task 557)
-- ob_question_patterns:
--   - contributor_alias (単一 TEXT) → contributor_aliases (JSONB array) に切替え、
--     複数 OB が同一質問パターンに寄与しても別名を失わないようにする。
--   - (company_id, theme, question_pattern) に UNIQUE index を張り、upsertObPattern の
--     原子的 upsert (INSERT → unique 制約違反時のみ UPDATE へ合流) の土台にする。
-- IMMUTABLE: 適用済 SQL は書き換えず、変更は 026_*.sql 以降で追記する。

ALTER TABLE ob_question_patterns ADD COLUMN IF NOT EXISTS contributor_aliases JSONB NOT NULL DEFAULT '[]';

UPDATE ob_question_patterns
SET contributor_aliases = jsonb_build_array(contributor_alias)
WHERE contributor_alias <> '' AND contributor_aliases = '[]'::jsonb;

-- company_id が NULL の行は PG の仕様上 UNIQUE 制約の対象外 (NULL 同士は区別される) だが、
-- upsertObPattern は companyId を必須入力として扱うため実運用上は問題にならない。
CREATE UNIQUE INDEX IF NOT EXISTS uq_obqp_dedup ON ob_question_patterns (company_id, theme, question_pattern);
