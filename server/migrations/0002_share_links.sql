-- server/migrations/0002_share_links.sql
-- Share-via-link: one instant-join link per shared folder, and per-collection
-- snapshot links (a copy handed to anyone holding the token).
CREATE TABLE folder_links (
  folder_id TEXT PRIMARY KEY REFERENCES shared_folders(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('read','write')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_folder_links_token ON folder_links(token);

CREATE TABLE collection_links (
  owner_google_id TEXT NOT NULL,
  collection_uid TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_google_id, collection_uid)
);
CREATE INDEX idx_collection_links_token ON collection_links(token);
