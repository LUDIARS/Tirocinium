-- Private routing metadata only. Never store ES or conversation bodies.
CREATE TABLE IF NOT EXISTS es_discord_routes (
  request_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'ob')),
  alias TEXT NOT NULL UNIQUE,
  token_hash TEXT UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  channel_id TEXT,
  PRIMARY KEY (request_id, role),
  UNIQUE (request_id, channel_id)
);
CREATE TABLE IF NOT EXISTS es_discord_deliveries (
  message_id TEXT PRIMARY KEY,
  request_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'sent', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL
);
