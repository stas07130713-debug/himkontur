CREATE TABLE IF NOT EXISTS map_download_snapshots (
  checksum TEXT PRIMARY KEY, project_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS map_operation_receipts (
  operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, revision INTEGER NOT NULL, object_ids_json TEXT NOT NULL
);
