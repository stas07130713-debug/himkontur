CREATE TABLE IF NOT EXISTS map_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  project_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  primary_revision INTEGER NOT NULL,
  mode TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_primary_success_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS map_operations (
  operation_id TEXT PRIMARY KEY,
  base_revision INTEGER NOT NULL,
  target_revision INTEGER NOT NULL,
  project_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_map_operations_status_created
ON map_operations(status, created_at);

CREATE TABLE IF NOT EXISTS map_history (
  revision INTEGER PRIMARY KEY,
  project_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  client_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL
);
