-- Cancellation survey (War Room "Feedback" tab). A row is created when the
-- survey email is sent (email/plan captured then); POST /survey/cancel fills
-- reason/comment/responded_at. One row per subscription; a resubmission
-- overwrites the answer.
CREATE TABLE cancel_surveys (
  subscription_id TEXT PRIMARY KEY,
  email           TEXT,
  plan            TEXT,
  reason          TEXT,
  comment         TEXT,
  emailed_at      INTEGER NOT NULL,
  responded_at    INTEGER
);
CREATE INDEX cancel_surveys_responded_at ON cancel_surveys(responded_at);
