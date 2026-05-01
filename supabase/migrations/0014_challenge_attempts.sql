-- =============================================================================
-- Hitster — Session 7 cleanup: per-team challenge attempts
-- Replaces challenges.started_at (single host-started global timer) with a
-- per-team attempt row. Each team's timer starts independently when they first
-- land on a challenge page. Supports independent retry after host reset.
-- =============================================================================

-- 1. Create the table
create table if not exists challenge_attempts (
    id           uuid        primary key default gen_random_uuid(),
    challenge_id uuid        not null references challenges(id) on delete cascade,
    team_id      uuid        not null references teams(id) on delete cascade,
    started_at   timestamptz not null default now(),
    ended_at     timestamptz,
    created_at   timestamptz not null default now(),
    constraint challenge_attempts_unique unique (challenge_id, team_id)
);

-- Partial index for the auto-submit sweep (open attempts only)
create index if not exists challenge_attempts_open_idx
    on challenge_attempts (challenge_id, started_at)
    where ended_at is null;

-- 2. Migrate existing data
-- For challenges that were already started under the old model, create attempt
-- rows for each team that submitted. Use challenges.started_at as the attempt
-- started_at (best approximation) and submissions.submitted_at as ended_at.
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_name = 'challenges' and column_name = 'started_at'
    ) then
        insert into challenge_attempts (challenge_id, team_id, started_at, ended_at)
        select
            s.challenge_id,
            s.team_id,
            c.started_at,
            s.submitted_at
        from submissions s
        join challenges c on c.id = s.challenge_id
        where c.started_at is not null
        on conflict (challenge_id, team_id) do nothing;
    end if;
end $$;

-- 3. Drop the now-superseded column (safe: data migrated above)
alter table challenges drop column if exists started_at;

-- 4. RLS: anon can read all attempts (required for realtime delivery)
alter table challenge_attempts enable row level security;

create policy "public read challenge_attempts"
    on challenge_attempts for select using (true);

-- Only the service-role admin client can insert/update — no anon write policy.

-- 5. Add to realtime publication so browser clients receive attempt updates
do $$ begin
    alter publication supabase_realtime add table challenge_attempts;
exception when others then null;
end $$;
