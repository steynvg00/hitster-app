-- 0054_insurance_copy_fix.sql
-- Corrects the Insurance powerup description. The old copy ("If you score 0 on your
-- next challenge, retroactively get 50% of max possible.") misdescribed the actual
-- behavior: any score below 50% of max is floored to 50% (see scoreSubmission() in
-- src/lib/server/scoring.ts). The reveal (earn) modal and the held-powerups tooltip
-- both render powerup_types.description, so this fixes both surfaces at the source.
--
-- The 0044 seed line was also updated for fresh installs; this migration updates the
-- already-seeded live row. Copy-only — no behavior/timing change.
--
-- Run manually in Supabase SQL Editor.

UPDATE powerup_types
  SET description = 'If your score is below 50% of max, it''s floored to 50%.'
  WHERE id = 'insurance';
