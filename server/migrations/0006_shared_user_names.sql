ALTER TABLE shared_folders ADD COLUMN owner_first_name TEXT;
ALTER TABLE shared_members ADD COLUMN first_name TEXT;
ALTER TABLE shared_activity ADD COLUMN actor_first_name TEXT;
ALTER TABLE shared_comments ADD COLUMN author_first_name TEXT;
