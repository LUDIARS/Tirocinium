-- 企業クロール + ES おすすめ企業 (spec/companies/README.md)
-- companies は公開情報のため保持可 (DESIGN §6 の個人データ境界対象外)。
-- company_recommendations は ES から導出した「ガイダンス結果」 であり、 ES 本文は持たない。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 004_*.sql 以降で追記する。

-- クロールで集めた企業プール
CREATE TABLE IF NOT EXISTS companies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,   -- dedup キー (lower + 法人格/記号除去)
  url             TEXT NOT NULL DEFAULT '',
  industry        TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  roles           TEXT[] NOT NULL DEFAULT '{}',  -- planner/programmer/designer/sound
  tags            TEXT[] NOT NULL DEFAULT '{}',  -- 技術スタック / 社風キーワード
  location        TEXT NOT NULL DEFAULT '',
  size            TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'unknown',
  source_url      TEXT NOT NULL DEFAULT '',
  crawled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_roles ON companies USING GIN (roles);
CREATE INDEX IF NOT EXISTS idx_companies_tags ON companies USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);

-- ES → おすすめ企業の結果 (導出ガイダンス。 ES 本文は保持しない)
CREATE TABLE IF NOT EXISTS company_recommendations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  query         JSONB NOT NULL DEFAULT '{}',  -- {target_role, target_company, tags, weak_axes}
  method        TEXT NOT NULL CHECK (method IN ('llm','heuristic')),
  model         TEXT NOT NULL DEFAULT 'none',
  items         JSONB NOT NULL DEFAULT '[]'   -- [{company_id, name, score, reasons[], concerns[]}]
);

CREATE INDEX IF NOT EXISTS idx_company_reco_user ON company_recommendations(user_id, created_at DESC);
