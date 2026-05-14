-- New tables
CREATE TABLE IF NOT EXISTS mashups (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text        NOT NULL,
    primary_clip_id uuid        NOT NULL REFERENCES clips(id) ON DELETE RESTRICT,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mashup_sources (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mashup_id  uuid NOT NULL REFERENCES mashups(id) ON DELETE CASCADE,
    track_id   uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    sort_order int  NOT NULL DEFAULT 0,
    UNIQUE (mashup_id, track_id)
);

-- Link mashup to a challenge_tab (only set when challenge.variant = 'mashup')
ALTER TABLE challenge_tabs ADD COLUMN IF NOT EXISTS mashup_id uuid NULL
    REFERENCES mashups(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE mashups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mashup_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_mashups"        ON mashups        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select_mashup_sources" ON mashup_sources FOR SELECT TO anon USING (true);

-- Realtime
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE mashups;        EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE mashup_sources; EXCEPTION WHEN others THEN null; END $$;

-- Wipe existing mashup-variant challenges entirely (test data only per user)
-- Cascade removes challenge_tabs, challenge_tab_source_tracks, challenge_tab_clips, submissions
DELETE FROM challenges WHERE variant = 'mashup';
