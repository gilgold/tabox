-- server/migrations/0001_shared_folders.sql
CREATE TABLE shared_folders (
  id TEXT PRIMARY KEY,
  owner_google_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX idx_shared_folders_owner ON shared_folders(owner_google_id);

CREATE TABLE shared_members (
  folder_id TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  google_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('read','write')),
  status TEXT NOT NULL CHECK (status IN ('invited','active','declined')),
  invited_at INTEGER NOT NULL,
  responded_at INTEGER,
  PRIMARY KEY (folder_id, email)
);
CREATE INDEX idx_shared_members_email ON shared_members(email);

CREATE TABLE shared_collections (
  folder_id TEXT NOT NULL REFERENCES shared_folders(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  data TEXT,
  rev INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (folder_id, uid)
);
CREATE INDEX idx_shared_collections_rev ON shared_collections(folder_id, rev);
