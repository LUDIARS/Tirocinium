-- games.series の表記揺れ正規化キー (#202)。 同シリーズ判定を normalizeSeries 由来の
-- 正規キー (略称/表記揺れ/下位シリーズを親へ畳んだ形) で行うための列。
-- 既存行の backfill は companies:series-normalize CLI で行う (アプリ側 normalizeSeries で算出、 SQL では算出しない)。
-- backfill 前は relatedCompaniesByGame が raw series へ degrade するため検索は壊れない。

ALTER TABLE games ADD COLUMN IF NOT EXISTS normalized_series TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_games_normalized_series ON games(normalized_series) WHERE normalized_series <> '';
