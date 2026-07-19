-- migration 025 (SQLite 方言): 025_ob_pattern_hardening.sql の SQLite 版。
-- SQLite は ADD COLUMN IF NOT EXISTS 非対応。migration runner が適用済みを管理するため
-- 素の ADD COLUMN でよい (024 の SQLite 版と同じ流儀)。

ALTER TABLE ob_question_patterns ADD COLUMN contributor_aliases TEXT NOT NULL DEFAULT '[]';

UPDATE ob_question_patterns
SET contributor_aliases = json_array(contributor_alias)
WHERE contributor_alias <> '' AND contributor_aliases = '[]';

CREATE UNIQUE INDEX IF NOT EXISTS uq_obqp_dedup ON ob_question_patterns (company_id, theme, question_pattern);
