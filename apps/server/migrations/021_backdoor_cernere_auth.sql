-- migration 021: 裏口 (卒業生/OB) 認証を Cernere に統一する。 マジックリンク (Bot B) を廃止。
-- 本人アンカーを Discord user id から Cernere の sub に置き換える。 これにより本体/面接/裏口の
-- 3 面すべてが Cernere 認証で揃う (spec/feature/web/backdoor.md)。
-- データ責務: 個人情報/ES/面接は Cernere、 Tr が持つのは履歴 + OB 求人 + 企業キャッシュのみ。
-- IMMUTABLE: 適用済 SQL は書き換えず、 変更は 022_*.sql 以降で追記する。

-- 投稿者/引き受け者のアンカーを Cernere sub に改名する。 索引は RENAME に追従する。
ALTER TABLE backdoor_alumni  RENAME COLUMN discord_user_id            TO cernere_user_id;
ALTER TABLE ob_job_postings  RENAME COLUMN posted_by_discord_user_id  TO posted_by_cernere_user_id;
ALTER TABLE ob_es_requests   RENAME COLUMN matched_ob_discord_user_id TO matched_ob_cernere_user_id;

-- マジックリンク / セッション token (backdoor_tokens) はコードから参照されなくなった。
-- HARNESS §2.3 (DROP TABLE 禁止) に従い物理削除はせず、 未使用テーブルとして残置する
-- (保持しているのは揮発トークンのみで残置に実害はない)。
