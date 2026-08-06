-- server/migrations/0005_member_via_link.sql
-- Tracks whether a member's role is governed by the folder's share link.
-- Set on link join; cleared when the owner sets that member's role explicitly.
-- Pre-existing rows default to 0 (link joins can't be distinguished
-- retroactively from invite accepts), so link role changes only reach
-- members who join after this migration.
ALTER TABLE shared_members ADD COLUMN via_link INTEGER NOT NULL DEFAULT 0;
