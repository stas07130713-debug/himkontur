CREATE TABLE IF NOT EXISTS map_object_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,
  base_revision INTEGER NOT NULL,
  target_revision INTEGER NOT NULL,
  object_id TEXT NOT NULL,
  object_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_map_object_changes_target
ON map_object_changes(target_revision, sequence);
