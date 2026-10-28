-- SFMC Toolkit 2.0.0 feedback form: kind, more details, app, technical details and
-- screenshots. Only adds; existing rows and SFMC Query Saver's posts keep working.
ALTER TABLE feedback ADD COLUMN details TEXT;
ALTER TABLE feedback ADD COLUMN kind TEXT;
ALTER TABLE feedback ADD COLUMN app TEXT;
ALTER TABLE feedback ADD COLUMN metadata TEXT;
ALTER TABLE feedback ADD COLUMN has_screenshot INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS feedback_screenshots (
  feedback_id INTEGER PRIMARY KEY,
  data_url    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
