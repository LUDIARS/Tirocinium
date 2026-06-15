-- 法人番号 (corporate_number, 13桁) を companies に追加 (spec/companies/gbizinfo.md §2)。
-- gBizINFO 由来の安定 dedup キー + 将来の英⇔カナ社名 名寄せ (本対応) の土台。
-- normalized_name と二重で持つ (社名表記揺れを超えた同定に使う)。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 013_*.sql 以降で追記する。

ALTER TABLE companies ADD COLUMN IF NOT EXISTS corporate_number TEXT NOT NULL DEFAULT '';

-- INDEX は ALTER の後に発行 ([[feedback_sqlite_create_index_after_alter]])。
-- 非空のみ対象 (空文字の重複を許す)。 UNIQUE にしない: 既存重複社の名寄せは別途 (本対応)。
CREATE INDEX IF NOT EXISTS idx_companies_corp_number ON companies(corporate_number) WHERE corporate_number <> '';
