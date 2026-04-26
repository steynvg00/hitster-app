-- =============================================================================
-- Hitster App — Initial Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ─── TABLES ──────────────────────────────────────────────────────────────────

create table teams (
  id         uuid        primary key default gen_random_uuid(),
  color      text        not null unique
                         check (color in ('blue','yellow','green','red','indigo','black')),
  label      text        not null,
  score      integer     not null default 0,
  created_at timestamptz not null default now()
);

create table players (
  id         uuid        primary key default gen_random_uuid(),
  team_id    uuid        not null references teams(id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now()
);

create table tracks (
  id           uuid        primary key default gen_random_uuid(),
  artist       text        not null,
  title        text        not null,
  year         integer     not null check (year between 1900 and 2100),
  record_label text,
  festival     text,
  vocal_source text,
  created_at   timestamptz not null default now()
);

create table clips (
  id           uuid        primary key default gen_random_uuid(),
  track_id     uuid        not null references tracks(id) on delete cascade,
  type         text        not null
                           check (type in ('snippet','fragment','kick','vocal','mashup')),
  storage_path text        not null,
  position     integer,
  created_at   timestamptz not null default now()
);

create table challenges (
  id            uuid        primary key default gen_random_uuid(),
  variant       text        not null
                            check (variant in ('normal','label','anthem','vocal','fragments','kick','mashup','battle')),
  title         text        not null,
  timer_seconds integer     not null default 60,
  is_active     boolean     not null default false,
  created_at    timestamptz not null default now()
);

create table challenge_tracks (
  id           uuid        primary key default gen_random_uuid(),
  challenge_id uuid        not null references challenges(id) on delete cascade,
  track_id     uuid        not null references tracks(id) on delete restrict,
  clip_id      uuid        not null references clips(id) on delete restrict,
  sort_order   integer     not null default 0,
  created_at   timestamptz not null default now()
);

-- NFC tag id is the physical chip UID (text, not uuid)
create table nfc_tags (
  id           text        primary key,
  purpose      text        not null
                           check (purpose in ('team_identity','team_entry','challenge')),
  team_color   text        check (team_color in ('blue','yellow','green','red','indigo','black')),
  challenge_id uuid        references challenges(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table answer_options (
  id           uuid        primary key default gen_random_uuid(),
  challenge_id uuid        not null references challenges(id) on delete cascade,
  field        text        not null
                           check (field in ('artist','title','year','label','festival','vocal_source')),
  value        text        not null,
  created_at   timestamptz not null default now()
);

create table submissions (
  id           uuid        primary key default gen_random_uuid(),
  challenge_id uuid        not null references challenges(id) on delete cascade,
  team_id      uuid        not null references teams(id) on delete cascade,
  answers      jsonb       not null default '{}',
  score        integer,
  submitted_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- one submission per team per challenge
  unique (challenge_id, team_id)
);

create table activity_log (
  id           uuid        primary key default gen_random_uuid(),
  event_type   text        not null,
  team_id      uuid        references teams(id) on delete set null,
  challenge_id uuid        references challenges(id) on delete set null,
  payload      jsonb,
  created_at   timestamptz not null default now()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────

create index on players          (team_id);
create index on clips            (track_id);
create index on clips            (type);
create index on challenge_tracks (challenge_id);
create index on challenge_tracks (track_id);
create index on nfc_tags         (challenge_id);
create index on answer_options   (challenge_id);
create index on answer_options   (challenge_id, field);
create index on submissions      (challenge_id);
create index on submissions      (team_id);
create index on activity_log     (team_id);
create index on activity_log     (challenge_id);
create index on activity_log     (created_at desc);

-- ─── SEED: 6 TEAMS ───────────────────────────────────────────────────────────

insert into teams (color, label) values
  ('blue',   'Blue: Raw'),
  ('yellow', 'Yellow: UV'),
  ('green',  'Green: Mainstage'),
  ('red',    'Red: Mainstage'),
  ('indigo', 'Indigo: Rawstyler'),
  ('black',  'Black: Freedom');

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────────────────────
-- Default posture: deny everything.
-- Public reads are granted below via explicit policies.
-- All host writes (scoring, managing challenges/tracks/clips) go through the
-- SUPABASE_SERVICE_ROLE_KEY on the server, which bypasses RLS entirely —
-- no write policies are needed for those tables.

alter table teams           enable row level security;
alter table players         enable row level security;
alter table tracks          enable row level security;
alter table clips           enable row level security;
alter table challenges      enable row level security;
alter table challenge_tracks enable row level security;
alter table nfc_tags        enable row level security;
alter table answer_options  enable row level security;
alter table submissions     enable row level security;
alter table activity_log    enable row level security;

-- Public read: reference data the browser needs to run the game
create policy "public read teams"
  on teams for select using (true);

create policy "public read players"
  on players for select using (true);

create policy "public read tracks"
  on tracks for select using (true);

create policy "public read clips"
  on clips for select using (true);

-- Teams only see active challenges (host controls this via is_active flag)
create policy "public read active challenges"
  on challenges for select using (is_active = true);

create policy "public read challenge_tracks"
  on challenge_tracks for select using (true);

create policy "public read nfc_tags"
  on nfc_tags for select using (true);

create policy "public read answer_options"
  on answer_options for select using (true);

-- Submissions: teams can insert their own, everyone can read (leaderboard)
create policy "public read submissions"
  on submissions for select using (true);

create policy "teams can submit"
  on submissions for insert with check (true);

-- Activity log: append-only from any client; no public reads
create policy "clients can log events"
  on activity_log for insert with check (true);

-- Players: teams register themselves
create policy "teams can add players"
  on players for insert with check (true);

-- ─── HOST BYPASS NOTE ────────────────────────────────────────────────────────
-- The server-side admin client (createAdminClient in src/lib/server/supabase.ts)
-- uses SUPABASE_SERVICE_ROLE_KEY. The service role bypasses RLS on every table,
-- so no additional policies are needed for admin write operations.
-- Wire this up in: admin routes, the scoring function, and NFC tag management.
