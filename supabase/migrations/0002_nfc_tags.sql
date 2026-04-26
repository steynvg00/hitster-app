-- =============================================================================
-- Hitster App — NFC Tag Seed Data
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- Run AFTER 0001_initial.sql (nfc_tags table must already exist).
-- Safe to re-run: ON CONFLICT DO NOTHING on every insert.
-- =============================================================================
-- Note: the nfc_tags table structure is defined in 0001_initial.sql.
-- This migration only seeds the known physical tag IDs.
-- =============================================================================

-- The challenge UUID from seed.sql (Round 1 — Normal Hitster)
-- Update this if the challenge ID changes.
do $$ declare
  v_challenge_id uuid := 'cccccccc-1111-1111-1111-000000000001'::uuid;
begin

  -- ── 6 Team identity tags (one per team) ────────────────────────────────────
  -- URL to write to NFC sticker: https://<your-domain>/nfc/team-blue
  insert into nfc_tags (id, purpose, team_color) values
    ('team-blue',   'team_identity', 'blue'),
    ('team-yellow', 'team_identity', 'yellow'),
    ('team-green',  'team_identity', 'green'),
    ('team-red',    'team_identity', 'red'),
    ('team-indigo', 'team_identity', 'indigo'),
    ('team-black',  'team_identity', 'black')
  on conflict (id) do nothing;

  -- ── 1 Challenge station tag (links to Round 1) ─────────────────────────────
  -- URL to write to NFC sticker: https://<your-domain>/nfc/station-mainstage-1
  insert into nfc_tags (id, purpose, challenge_id) values
    ('station-mainstage-1', 'challenge', v_challenge_id)
  on conflict (id) do nothing;

  -- ── 1 Randomizer entry tag (snake-order team assignment) ───────────────────
  -- URL to write to NFC sticker: https://<your-domain>/nfc/random-entry
  insert into nfc_tags (id, purpose) values
    ('random-entry', 'team_entry')
  on conflict (id) do nothing;

end $$;
