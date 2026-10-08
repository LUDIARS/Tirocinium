-- Private routing metadata only. Never store ES or conversation bodies.
CREATE TABLE IF NOT EXISTS es_discord_routes (
  request_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'ob')),
  alias TEXT NOT NULL UNIQUE,
  token_hash TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  channel_id TEXT,
  PRIMARY KEY (request_id, role),
  UNIQUE (request_id, channel_id)
);
CREATE TABLE IF NOT EXISTS es_discord_deliveries (
  message_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent', 'unknown')),
  created_at TEXT NOT NULL
);
