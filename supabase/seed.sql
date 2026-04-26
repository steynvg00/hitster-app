-- =============================================================================
-- Hitster App — Session 3 Seed Data
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- Run AFTER 0001_initial.sql (the schema must already exist).
-- Safe to re-run: fixed UUIDs + ON CONFLICT / DELETE-before-insert.
-- =============================================================================

do $$ declare
  v_track_id     uuid := 'aaaaaaaa-1111-1111-1111-000000000001'::uuid;
  v_clip_id      uuid := 'bbbbbbbb-1111-1111-1111-000000000001'::uuid;
  v_challenge_id uuid := 'cccccccc-1111-1111-1111-000000000001'::uuid;
  v_ct_id        uuid := 'dddddddd-1111-1111-1111-000000000001'::uuid;
begin

  -- ── Track ──────────────────────────────────────────────────────────────────
  insert into tracks (id, artist, title, year, record_label) values
    (v_track_id, 'Angerfist', 'Rattlesnake', 2009, 'BZRK Records')
  on conflict (id) do nothing;

  -- ── Clip ───────────────────────────────────────────────────────────────────
  -- PLACEHOLDER URL — swap for a real audio file before the party.
  -- Any full https:// URL is used directly; a bare path is resolved via
  -- Supabase Storage (see challenge page load function).
  insert into clips (id, track_id, type, storage_path) values
    (v_clip_id, v_track_id, 'snippet',
     'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3')
  on conflict (id) do nothing;

  -- ── Challenge ──────────────────────────────────────────────────────────────
  insert into challenges (id, variant, title, timer_seconds, is_active) values
    (v_challenge_id, 'normal', 'Round 1 — Normal Hitster', 60, true)
  on conflict (id) do nothing;

  -- ── Challenge → track link ──────────────────────────────────────────────────
  insert into challenge_tracks (id, challenge_id, track_id, clip_id, sort_order) values
    (v_ct_id, v_challenge_id, v_track_id, v_clip_id, 0)
  on conflict (id) do nothing;

  -- ── Answer options (dropdowns) ─────────────────────────────────────────────
  -- Delete first so re-runs stay clean (no unique constraint on this table).
  delete from answer_options where challenge_id = v_challenge_id;

  insert into answer_options (challenge_id, field, value) values
    (v_challenge_id, 'artist', 'Angerfist'),
    (v_challenge_id, 'artist', 'Endymion'),
    (v_challenge_id, 'artist', 'Noize MC'),
    (v_challenge_id, 'artist', 'Drokz'),
    (v_challenge_id, 'title',  'Rattlesnake'),
    (v_challenge_id, 'title',  'Hellbound'),
    (v_challenge_id, 'title',  'Indestructible'),
    (v_challenge_id, 'title',  'Renegades');

end $$;

-- =============================================================================
-- Realtime — allow the leaderboard to subscribe to live score changes.
-- Wrapped in exception blocks so re-runs are safe if already enabled.
-- =============================================================================

do $$ begin
  alter publication supabase_realtime add table teams;
exception when others then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table submissions;
exception when others then null;
end $$;
