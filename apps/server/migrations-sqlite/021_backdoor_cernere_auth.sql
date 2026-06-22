-- migration 021 (SQLite 方言): 裏口 (卒業生/OB) 認証を Cernere に統一する。 マジックリンク (Bot B) を廃止。
-- migrations/021_backdoor_cernere_auth.sql の SQLite 版。
-- SQLite 3.25+ の RENAME COLUMN は当該列を参照する索引定義を自動で追従する。

ALTER TABLE backdoor_alumni  RENAME COLUMN discord_user_id            TO cernere_user_id;
ALTER TABLE ob_job_postings  RENAME COLUMN posted_by_discord_user_id  TO posted_by_cernere_user_id;
ALTER TABLE ob_es_requests   RENAME COLUMN matched_ob_discord_user_id TO matched_ob_cernere_user_id;

DROP TABLE IF EXISTS backdoor_tokens;
