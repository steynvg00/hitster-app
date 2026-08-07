-- 0077_persist_fields_correct.sql
--
-- Persists, per submission, HOW MANY fields the team got fully right and how many
-- there were to get right. Two integers, written by the same submission write that
-- already stores the score.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
-- A later earning condition wants a per-team "average % of fields correct over the
-- challenges this team actually played" — the performance axis of a safety-net
-- powerup. Today that number is NOT recoverable after the fact:
--
--   submissions.score          is finalScore — AFTER multipliers, streak, speed and
--                              powerup bonuses. Useless as a correctness numerator.
--   submissions.answers[0]     carries a ScoreBreakdown (base, multipliers, final)
--                              but NOT the bonus-excluded threshold pair, and never
--                              a field count.
--
-- The per-field verdict exists only in memory during scoring and is thrown away
-- when the row is written. These two columns keep it. Storing the COUNTS rather
-- than a percentage keeps the aggregation honest: SUM(fields_correct) /
-- SUM(fields_total) weights every field equally across challenges, whereas
-- averaging per-challenge percentages would over-weight a one-field challenge.
--
-- ── Why nullable ─────────────────────────────────────────────────────────────
-- Rows written before this migration have no counts and cannot get them (the
-- verdict is gone). NULL says "unknown", which is exactly what it is — and it makes
-- the future aggregate self-filtering: SUM() skips NULLs, so an old row drops out
-- of the average instead of poisoning it with a fake 0/0. A DEFAULT 0 would have
-- been the trap: it reads as "answered nothing right", which is a lie about a row
-- that may well have been perfect.
--
-- In practice this affects nothing on the night — the reset SQL clears submissions
-- between games — but the column semantics have to be right regardless.
--
-- ── What "fully right" means ─────────────────────────────────────────────────
-- Not a new rule. It is the bar the codebase already set in
-- src/lib/server/scoring.ts (fieldIsFullyCorrect, used by the lifeline powerup to
-- decide which cell deserves a hint): a field counts as correct when it earns its
-- FULL points. Partial credit — a year one off (50%), a 65%-similar title (50%) —
-- counts as WRONG, because a hint-worthy answer is a wrong answer. The counting
-- fold and that predicate now share one implementation
-- (fieldResultIsFullyCorrect in src/lib/threshold.ts) so they cannot drift.
--
-- Excluded from BOTH numerator and denominator, mirroring the existing
-- bonus-excluded threshold rule (thresholdOfFields, $lib/threshold):
--   * bonus fields  — optional extra work; counting them in the denominator would
--                     penalise a team for skipping what was never required, and it
--                     would decouple this ratio from the earn-% that already
--                     excludes them.
--   * grouping      — scored across a tab, not per track; fieldIsFullyCorrect
--                     returns false for it because there is nothing to be right
--                     about at this granularity. Including it would require
--                     inventing a rule, which this migration deliberately does not.
--
-- An empty submission (the auto-submit backstop, a team that answered nothing) gets
-- fields_correct = 0 with fields_total = the challenge's real field count — NOT
-- NULL. Scoring nothing is a measured 0%, and for a safety-net signal that is the
-- single most important data point to record.
--
-- ── Safety ───────────────────────────────────────────────────────────────────
-- Purely additive: two nullable columns, no default, no constraint, no index, no
-- backfill. Nothing reads them yet — this migration only starts the collection.
-- Idempotent; safe to re-run.

ALTER TABLE submissions
    ADD COLUMN IF NOT EXISTS fields_correct integer,
    ADD COLUMN IF NOT EXISTS fields_total integer;

COMMENT ON COLUMN submissions.fields_correct IS
    'Number of non-bonus, non-grouping fields this submission got FULL points on (see fieldResultIsFullyCorrect, src/lib/threshold.ts). NULL = written before migration 0077.';

COMMENT ON COLUMN submissions.fields_total IS
    'Number of non-bonus, non-grouping fields this submission could have got right, across every tab and slot. 0 correct out of N is recorded as 0/N, never NULL. NULL = written before migration 0077.';
