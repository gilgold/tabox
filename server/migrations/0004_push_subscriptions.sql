CREATE TABLE push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_ok_at  INTEGER
);
CREATE INDEX idx_push_subs_email ON push_subscriptions(user_email);
