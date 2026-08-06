-- server/migrations/0003_activity_comments.sql
CREATE TABLE shared_activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id   TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  subject     TEXT,            -- collection uid or member email
  detail      TEXT,            -- JSON display snapshot, e.g. {"name":"Research links"}
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_activity_folder ON shared_activity(folder_id, id);

CREATE TABLE shared_comments (
  id             TEXT PRIMARY KEY,
  folder_id      TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
  collection_uid TEXT,          -- NULL = folder-level thread
  author_email   TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  deleted        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_comments_thread ON shared_comments(folder_id, collection_uid, created_at);
