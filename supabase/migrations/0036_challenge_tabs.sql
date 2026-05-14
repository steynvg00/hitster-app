-- Migration 0036: challenge_tabs (FIXED ORDER — both CHECK constraints)

-- ─── New tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS challenge_tabs (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id uuid        NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    position     int         NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS challenge_tab_source_tracks (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tab_id     uuid NOT NULL REFERENCES challenge_tabs(id) ON DELETE CASCADE,
    track_id   uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    sort_order int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS challenge_tab_clips (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tab_id          uuid NOT NULL REFERENCES challenge_tabs(id) ON DELETE CASCADE,
    clip_id         uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    fragment_number int  NULL,
    sort_order      int  NOT NULL DEFAULT 0
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE challenge_tabs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_tab_source_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_tab_clips         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_challenge_tabs"
    ON challenge_tabs FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select_challenge_tab_source_tracks"
    ON challenge_tab_source_tracks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select_challenge_tab_clips"
    ON challenge_tab_clips FOR SELECT TO anon USING (true);

-- ─── Realtime publication ─────────────────────────────────────────────────────
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE challenge_tabs;              EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE challenge_tab_source_tracks; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE challenge_tab_clips;         EXCEPTION WHEN others THEN null; END $$;

-- ─── Widen BOTH CHECK constraints (challenges + variant_defaults) ─────────────
DO $$ BEGIN
    ALTER TABLE challenges DROP CONSTRAINT challenges_variant_check;
EXCEPTION WHEN others THEN null; END $$;

ALTER TABLE challenges
    ADD CONSTRAINT challenges_variant_check
    CHECK (variant IN ('standard','anthem','label','mashup','fragments','normal','vocal','kick','battle'));

DO $$ BEGIN
    ALTER TABLE variant_defaults DROP CONSTRAINT variant_defaults_variant_check;
EXCEPTION WHEN others THEN null; END $$;

ALTER TABLE variant_defaults
    ADD CONSTRAINT variant_defaults_variant_check
    CHECK (variant IN ('standard','anthem','label','mashup','fragments','normal','vocal','kick','battle'));

-- ─── Data migration block ─────────────────────────────────────────────────────
DO $$
DECLARE
    ct_row          RECORD;
    sub_row         RECORD;
    old_entry       jsonb;
    new_answers     jsonb;
    new_entry       jsonb;
    source_ans      jsonb;
    breakdown_val   jsonb;
    entry_idx       int;
    new_tab_id      uuid;
    lowest_clip_id  uuid;
    tab_pos         int;
BEGIN
    FOR ct_row IN
        SELECT id, challenge_id, track_id, clip_id, sort_order
        FROM challenge_tracks
        ORDER BY challenge_id, sort_order
    LOOP
        INSERT INTO challenge_tabs (challenge_id, position, created_by)
        VALUES (ct_row.challenge_id, ct_row.sort_order, NULL)
        RETURNING id INTO new_tab_id;

        INSERT INTO challenge_tab_source_tracks (tab_id, track_id, sort_order)
        VALUES (new_tab_id, ct_row.track_id, 0);

        IF ct_row.clip_id IS NOT NULL THEN
            INSERT INTO challenge_tab_clips (tab_id, clip_id, fragment_number, sort_order)
            VALUES (new_tab_id, ct_row.clip_id, NULL, 0);
        ELSE
            SELECT id INTO lowest_clip_id
            FROM clips
            WHERE track_id = ct_row.track_id
            ORDER BY created_at
            LIMIT 1;

            IF lowest_clip_id IS NOT NULL THEN
                INSERT INTO challenge_tab_clips (tab_id, clip_id, fragment_number, sort_order)
                VALUES (new_tab_id, lowest_clip_id, NULL, 0);
            END IF;
        END IF;
    END LOOP;

    UPDATE challenges
    SET variant = 'standard'
    WHERE variant IN ('normal', 'vocal', 'kick', 'battle');

    FOR sub_row IN
        SELECT id, challenge_id, answers
        FROM submissions
        WHERE jsonb_typeof(answers) = 'array'
          AND jsonb_array_length(answers) > 0
    LOOP
        new_answers := '[]'::jsonb;
        entry_idx   := 0;

        FOR old_entry IN SELECT jsonb_array_elements(sub_row.answers)
        LOOP
            SELECT ct.position INTO tab_pos
            FROM challenge_tabs ct
            JOIN challenge_tab_source_tracks ctst ON ctst.tab_id = ct.id
            WHERE ct.challenge_id = sub_row.challenge_id
              AND ctst.track_id::text = (old_entry->>'track_id')
            LIMIT 1;

            IF tab_pos IS NULL THEN tab_pos := entry_idx; END IF;

            source_ans := jsonb_build_object(
                'slot_index',              0,
                'matched_source_track_id', old_entry->>'track_id',
                'field_values',            COALESCE(old_entry->'field_values', '{}'::jsonb),
                'scored',                  COALESCE(old_entry->'scored',       '{}'::jsonb),
                'total',                   COALESCE(old_entry->'total',        '0'::jsonb)
            );

            breakdown_val := old_entry->'breakdown';

            new_entry := jsonb_build_object(
                'tab_position',   tab_pos,
                'source_answers', jsonb_build_array(source_ans)
            );

            IF breakdown_val IS NOT NULL THEN
                new_entry := new_entry || jsonb_build_object('breakdown', breakdown_val);
            END IF;

            new_answers := new_answers || jsonb_build_array(new_entry);
            entry_idx   := entry_idx + 1;
        END LOOP;

        UPDATE submissions SET answers = new_answers WHERE id = sub_row.id;
    END LOOP;

    UPDATE variant_defaults SET variant = 'standard' WHERE variant = 'normal';
    DELETE FROM variant_defaults WHERE variant IN ('vocal', 'kick', 'battle');

    INSERT INTO variant_defaults (variant, points_config)
    VALUES
        ('standard', '{"field_points":{"artist":10,"title":10,"year":10}}'::jsonb),
        ('anthem',   '{"field_points":{"festival":10,"artist":10,"title":10,"year":10}}'::jsonb),
        ('label',    '{"field_points":{"label":10,"artist":10,"title":10,"year":10}}'::jsonb),
        ('mashup',   '{"field_points":{"artist":10,"title":10,"year":10}}'::jsonb),
        ('fragments','{"field_points":{"artist":10,"title":10,"year":10,"grouping":10}}'::jsonb)
    ON CONFLICT (variant) DO NOTHING;
END $$;

-- ─── Tighten BOTH CHECK constraints to new values only ────────────────────────
ALTER TABLE challenges DROP CONSTRAINT challenges_variant_check;
ALTER TABLE challenges
    ADD CONSTRAINT challenges_variant_check
    CHECK (variant IN ('standard','anthem','label','mashup','fragments'));

ALTER TABLE variant_defaults DROP CONSTRAINT variant_defaults_variant_check;
ALTER TABLE variant_defaults
    ADD CONSTRAINT variant_defaults_variant_check
    CHECK (variant IN ('standard','anthem','label','mashup','fragments'));

-- ─── Drop challenge_tracks ────────────────────────────────────────────────────
DROP TABLE IF EXISTS challenge_tracks CASCADE;
