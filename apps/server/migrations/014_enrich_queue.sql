-- 自動 enrich キューの進行カーソル。 概要なしのゲーム関連企業を 1 分 1 件で順次クロールする
-- バックグラウンド処理が、 同じ企業を再試行し続けないよう「最後に試した時刻」を持つ。
-- IMMUTABLE: 変更は 015_*.sql 以降。

ALTER TABLE companies ADD COLUMN IF NOT EXISTS enrich_attempted_at TIMESTAMPTZ;

-- 未試行 (NULL) を優先しつつ、 試行済の再巡回も拾えるよう時刻でインデックス。
CREATE INDEX IF NOT EXISTS idx_companies_enrich_cursor ON companies(enrich_attempted_at);
