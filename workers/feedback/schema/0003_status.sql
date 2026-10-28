-- Triage status per feedback row, set by hand (wrangler d1 execute) when a row is
-- reviewed. Only adds nullable columns; the worker's INSERT names its columns, so
-- posts keep working. status: released, fixed, partial, waiting, open, wontfix,
-- duplicate, test. status_version: the version that carries the fix.
-- status_at: milliseconds since 1970, like created_at.
ALTER TABLE feedback ADD COLUMN status TEXT;
ALTER TABLE feedback ADD COLUMN status_note TEXT;
ALTER TABLE feedback ADD COLUMN status_version TEXT;
ALTER TABLE feedback ADD COLUMN status_at INTEGER;
