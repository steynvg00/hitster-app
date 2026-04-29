-- =============================================================================
-- Hitster — Session 6: Curated answer pools
-- Shared pool tables for combobox fields (not per-challenge — global library).
-- =============================================================================

CREATE TABLE answer_pool_artists (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE answer_pool_labels (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE answer_pool_festivals (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE answer_pool_vocal_sources (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for name lookups
CREATE INDEX ON answer_pool_artists       (name);
CREATE INDEX ON answer_pool_labels        (name);
CREATE INDEX ON answer_pool_festivals     (name);
CREATE INDEX ON answer_pool_vocal_sources (name);

-- RLS: public read (combobox loads pool server-side via admin client, but enable for safety)
ALTER TABLE answer_pool_artists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_pool_labels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_pool_festivals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_pool_vocal_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read answer_pool_artists"       ON answer_pool_artists       FOR SELECT USING (true);
CREATE POLICY "public read answer_pool_labels"        ON answer_pool_labels        FOR SELECT USING (true);
CREATE POLICY "public read answer_pool_festivals"     ON answer_pool_festivals     FOR SELECT USING (true);
CREATE POLICY "public read answer_pool_vocal_sources" ON answer_pool_vocal_sources FOR SELECT USING (true);

-- Seed: artists from existing seed track + common Defqon/Hardstyle artists
INSERT INTO answer_pool_artists (name) VALUES
  ('Angerfist'),
  ('Endymion'),
  ('Noize MC'),
  ('Drokz'),
  ('Crypsis'),
  ('The Destroyer'),
  ('Ophidian'),
  ('Donkey Rollers'),
  ('Coone'),
  ('Headhunterz'),
  ('Brennan Heart'),
  ('Wildstylez'),
  ('Gunz for Hire'),
  ('Ran-D'),
  ('Radical Redemption'),
  ('Warface'),
  ('Miss K8'),
  ('Dr. Peacock'),
  ('Partyraiser'),
  ('Rebelion')
ON CONFLICT (name) DO NOTHING;

INSERT INTO answer_pool_labels (name) VALUES
  ('BZRK Records'),
  ('Industrial Strength'),
  ('Neophyte Records'),
  ('Masters of Hardcore'),
  ('Megarave Records'),
  ('Fusion Records'),
  ('Theracords'),
  ('Q-dance Records')
ON CONFLICT (name) DO NOTHING;
