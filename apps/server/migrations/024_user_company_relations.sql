-- GLabHub から登録する志望企業・内定企業の履歴。
-- 本人アンカーは Cernere sub、企業の公開情報は companies を正本とする。
-- 生の ES・面接ログ等は保持しない。

CREATE TABLE user_company_relations (
  cernere_user_id TEXT NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('desired', 'offer')),
  role_title TEXT NOT NULL DEFAULT '',
  offered_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cernere_user_id, company_id, relation_type),
  CHECK (length(cernere_user_id) BETWEEN 1 AND 200),
  CHECK (length(role_title) <= 200),
  CHECK (relation_type = 'offer' OR (role_title = '' AND offered_on IS NULL))
);

CREATE INDEX idx_user_company_relations_user_updated
  ON user_company_relations (cernere_user_id, updated_at DESC);
