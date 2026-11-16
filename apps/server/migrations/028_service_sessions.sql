-- spec/feature/web/cernere-composite-login.md
-- Tirocinium 自前のログインセッション。token 本体は保存せず SHA-256 (16 進) だけを持つ。
-- Cernere の user token / refresh token は保存しない (交換で受け取らない)。
CREATE TABLE IF NOT EXISTS tirocinium_service_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS tirocinium_service_sessions_expires_idx
  ON tirocinium_service_sessions (expires_at_ms);
