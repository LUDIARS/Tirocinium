-- 企業クロールキューの「子クローラ連鎖」追跡列。 spec/feature/companies/crawl-queue.md。
-- crawl-queue worker が企業 upsert 後に CLI 子クローラ (cli backend で works→ゲーム紐付け +
-- recruit-page 求人 + IR/理念 を深掘り) を spawn する。 その子の状態をここに残す。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 024_*.sql 以降で追記する。

ALTER TABLE crawl_jobs ADD COLUMN child_status TEXT NOT NULL DEFAULT 'none';   -- none|spawned|running|done|failed
ALTER TABLE crawl_jobs ADD COLUMN child_log    TEXT NOT NULL DEFAULT '';        -- 子のログファイルパス
ALTER TABLE crawl_jobs ADD COLUMN child_detail TEXT NOT NULL DEFAULT '';        -- 子の結果サマリ (1 行)
