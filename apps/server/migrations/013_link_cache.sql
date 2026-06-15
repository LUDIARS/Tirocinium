-- ユーザ提供リンクの取得キャッシュ (情報提供ウインドウ)。 同一 URL の再取得を避ける。
-- 本文は LLM 分類 (企業/ゲーム/新卒) の入力に使う一時データ。 IMMUTABLE: 変更は 014_*.sql 以降。

CREATE TABLE IF NOT EXISTS link_cache (
  url            TEXT PRIMARY KEY,
  normalized_url TEXT NOT NULL DEFAULT '',
  title          TEXT NOT NULL DEFAULT '',
  content_text   TEXT NOT NULL DEFAULT '',
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_link_cache_normalized ON link_cache(normalized_url) WHERE normalized_url <> '';
