-- 企業クロールキュー (crawl_jobs) の永続化。 spec/feature/companies/crawl-queue.md。
-- URL を投入すると 1 件ずつ順次クロールして企業を upsert する常駐 worker の待ち行列。
-- Web 取得は直列 (重複リクエストの無駄処理回避 + 負荷対策)。 公開 URL のみ保持 (個人データ境界 §6 対象外)。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 023_*.sql 以降で追記する。

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  url          TEXT NOT NULL,                       -- クロール対象 URL
  name_hint    TEXT NOT NULL DEFAULT '',            -- 既知の社名 (抽出ヒント、 任意)
  source       TEXT NOT NULL DEFAULT 'manual',      -- crawl source id (manual / seed-file 等)
  status       TEXT NOT NULL DEFAULT 'queued',      -- queued | running | done | failed
  max_pages    INTEGER,                             -- per-job のページ上限 (NULL は既定)
  attempts     INTEGER NOT NULL DEFAULT 0,          -- 試行回数 (maxAttempts で打ち切り)
  summary      TEXT NOT NULL DEFAULT '',            -- 完了時の CrawlSummary (JSON 文字列)
  error        TEXT NOT NULL DEFAULT '',            -- 失敗理由 (最終)
  requested_by TEXT NOT NULL DEFAULT '',            -- 投入者 Cernere user id (任意)
  enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs(status);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_enqueued ON crawl_jobs(enqueued_at DESC);
-- 同一 URL が同時に複数 queued/running になるのを防ぐ (enqueue 時の重複畳み込みを DB でも担保)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_crawl_jobs_active_url
  ON crawl_jobs(url) WHERE status IN ('queued', 'running');
