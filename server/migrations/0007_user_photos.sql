ALTER TABLE shared_folders ADD COLUMN owner_photo_link TEXT;
ALTER TABLE shared_members ADD COLUMN photo_link TEXT;
ALTER TABLE shared_activity ADD COLUMN actor_photo_link TEXT;
ALTER TABLE shared_comments ADD COLUMN author_photo_link TEXT;
