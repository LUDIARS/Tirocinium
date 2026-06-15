-- 所在地文字列 → 緯度経度 のジオコーディングキャッシュ (Google Maps ビュー)。
-- 企業の location は都道府県/市レベルで重複が多い (実測 288社/119種) ため、 文字列単位で
-- キャッシュすれば API 呼び出しを最小化できる。 ok=false は失敗 (再試行を抑制)。
-- IMMUTABLE: 変更は 016_*.sql 以降。

CREATE TABLE IF NOT EXISTS geocode_cache (
  location     TEXT PRIMARY KEY,
  lat          DOUBLE PRECISION NOT NULL DEFAULT 0,
  lng          DOUBLE PRECISION NOT NULL DEFAULT 0,
  ok           BOOLEAN NOT NULL DEFAULT FALSE,
  geocoded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
