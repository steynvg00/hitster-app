-- 0056_powerup_types_coming_soon.sql
--
-- Piece 2 of 4 rebuilding per-set powerup earning (config v2 → console swap →
-- runtime v2 → penalty_shot). The admin console's powerup list is switching
-- from the legacy 10-item `powerups`/`set_powerups` catalog (fully decorative
-- — nothing in the earning/activation runtime reads it) to the real 7
-- `powerup_types` rows. To show the FULL intended roster (so the console
-- reads as "here's everything, some pieces are still being built" rather than
-- silently dropping the legacy items), this migration seeds the not-yet-built
-- types as `coming_soon` placeholder rows.
--
-- coming_soon = true rows have NO runtime behavior: enabled_by_default = false
-- means maybeAwardPowerup's eligibility query (`.eq('enabled_by_default', true)`)
-- already excludes them even without reading the new column. The column exists
-- purely so the console can render them as disabled "Coming soon" rows instead
-- of a live-but-nonfunctional toggle.
--
-- Category note: `penalty_shot` is the inverse "low-score" mechanic from the
-- piece-2 design discussion. The existing `powerup_types.category` CHECK
-- constraint (migration 0044) already allows 'punishment' as a value (added
-- up front, never used until now) — used here rather than 'social' or adding
-- a new category, so no CHECK constraint change is needed.
--
-- Icon note: powerup_types.icon is rendered as raw text everywhere
-- (HeldPowerups.svelte, PowerupActivationModal.svelte, PowerupRevealModal.svelte
-- all do `{type.icon}` directly) — it stores an emoji character, not a lucide
-- icon name. Seeded with emoji to match the existing 7 rows and render
-- correctly with no code changes.
--
-- Run manually in Supabase SQL Editor.

DO $$ BEGIN
  ALTER TABLE powerup_types ADD COLUMN IF NOT EXISTS coming_soon boolean NOT NULL DEFAULT false;
EXCEPTION WHEN others THEN null; END $$;

-- Seed 8 placeholder rows (unbuilt offensive types + give_a_shot [social] +
-- double_down/lifeline [defensive] + lucky_dice [self], carried over from the
-- legacy 0032 catalog's categories for continuity; penalty_shot is new).
-- ON CONFLICT DO NOTHING: idempotent, never touches the existing 7 working rows.
INSERT INTO powerup_types
  (id, name, category, description, immediate_use, holdable, default_min_score_pct, default_max_score_pct, icon, sort_order, enabled_by_default, coming_soon)
VALUES
  ('freeze',        'Freeze',        'offensive',  'Freezes an opposing team''s timer for a short window. (Coming soon — not yet implemented.)',                          false, true, 0, 100, '🧊', 80,  false, true),
  ('time_drain',    'Time Drain',    'offensive',  'Drains time from an opposing team''s challenge timer. (Coming soon — not yet implemented.)',                          false, true, 0, 100, '⏳', 90,  false, true),
  ('tap_to_break',  'Tap to Break',  'offensive',  'Forces an opposing team through an extra step before they can submit. (Coming soon — not yet implemented.)',           false, true, 0, 100, '🔨', 100, false, true),
  ('give_a_shot',   'Give a Shot',   'social',     'Assigns a real-world forfeit to an opposing team. (Coming soon — not yet implemented.)',                              false, true, 0, 100, '🥂', 110, false, true),
  ('double_down',   'Double Down',   'defensive',  'Doubles the stakes on your next challenge — bigger reward, bigger risk. (Coming soon — not yet implemented.)',        false, true, 0, 100, '🎰', 120, false, true),
  ('lifeline',      'Lifeline',      'defensive',  'Grants a second chance on a failed challenge. (Coming soon — not yet implemented.)',                                  false, true, 0, 100, '🆘', 130, false, true),
  ('lucky_dice',    'Lucky Dice',    'self',       'Rolls for a random bonus effect. (Coming soon — not yet implemented.)',                                              false, true, 0, 100, '🍀', 140, false, true),
  ('penalty_shot',  'Penalty Shot',  'punishment', 'Awarded for a LOW score instead of a high one — the inverse of every other powerup. Earning logic lands in piece 3; effect design is separate. (Coming soon — not yet implemented.)', false, true, 0, 100, '🥃', 150, false, true)
ON CONFLICT (id) DO NOTHING;
