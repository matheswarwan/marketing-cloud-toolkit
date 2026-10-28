-- The table SFMC Query Saver created (already in production; kept for reference).
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT    NOT NULL,
  screen     TEXT    NOT NULL DEFAULT 'unknown',
  version    TEXT    NOT NULL DEFAULT 'unknown',
  name       TEXT,
  email      TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
