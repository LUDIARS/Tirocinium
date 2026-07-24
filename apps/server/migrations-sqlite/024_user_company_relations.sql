-- migration 024 (SQLite 方言): GLabHub の志望企業・内定企業履歴。

CREATE TABLE user_company_relations (
  cernere_user_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('desired', 'offer')),
  role_title TEXT NOT NULL DEFAULT '',
  offered_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (cernere_user_id, company_id, relation_type),
  CHECK (length(cernere_user_id) BETWEEN 1 AND 200),
  CHECK (length(role_title) <= 200),
  CHECK (relation_type = 'offer' OR (role_title = '' AND offered_on IS NULL))
);

CREATE INDEX idx_user_company_relations_user_updated
  ON user_company_relations (cernere_user_id, updated_at DESC);
