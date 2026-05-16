-- Make timer_seconds nullable: NULL means no per-challenge timer (unlimited).
-- A value of 0 or positive integer still means a timed challenge.
ALTER TABLE challenges ALTER COLUMN timer_seconds DROP NOT NULL;
ALTER TABLE challenges ALTER COLUMN timer_seconds DROP DEFAULT;
