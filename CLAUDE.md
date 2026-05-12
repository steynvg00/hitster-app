# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web app for a 28-person, 6-team weekend party game. Core mechanic: Hitster-style music guessing with a Defqon/hard-bass theme. Teams scan NFC stickers to reach challenge pages, listen to audio clips, and guess artist/title/year (or other fields depending on variant). A host admin manages challenges, scoring, and reviews on a password-protected back-end.

## Development commands

```bash
npm run dev          # local dev server (http://localhost:5173)
npm run build        # production build
npm run check        # svelte-check (TypeScript + Svelte type errors)
npm run check:watch  # same but incremental
npm run lint         # prettier + eslint
npm run format       # auto-fix formatting
```

There are **no tests** in this project. `npm run check` is the primary correctness gate.

## Environment variables

Copy `.env.example` → `.env`. Required keys:

| Key                         | Used in                              |
| --------------------------- | ------------------------------------ |
| `PUBLIC_SUPABASE_URL`       | both server and browser              |
| `PUBLIC_SUPABASE_ANON_KEY`  | both server and browser              |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only (admin client)           |
| `COOKIE_SECRET`             | HMAC signing of team + admin cookies |
| `HOST_PASSWORD`             | admin login                          |

## Architecture

### Two Supabase clients — never mix them

| Client                        | Created by              | Key          | RLS      | Used for                                           |
| ----------------------------- | ----------------------- | ------------ | -------- | -------------------------------------------------- |
| `createPublicClient(cookies)` | `$lib/server/supabase`  | anon         | enforced | server-side load fns, form actions (player-facing) |
| `createAdminClient()`         | `$lib/server/supabase`  | service role | bypassed | scoring, team score updates, admin ops             |
| `supabaseBrowser`             | `$lib/supabase-browser` | anon         | enforced | client-side realtime subscriptions only            |

The admin client is server-only. It must never be imported from `.svelte` files or `+page.ts` (client-runnable) files.

### Authentication

Host auth uses **Supabase Auth** (email magic link + Google OAuth), added in Session A. The admin layout guard (`/admin/+layout.server.ts`) checks `locals.user` (set by `hooks.server.ts` from the Supabase session) and redirects to `/admin/login` if absent.

Player and team identity still use custom HMAC-SHA256 signed cookies:

- **`hitster_team`** (7 days) — team identity. Set by `/nfc/[tag]` or `/join`. Read by `hooks.server.ts` → `locals.teamId`.
- **`hitster_player`** (12h) — player session. Set by `/play/[mode]` form action. Decoded into `locals.playerId`. `$lib/server/player.ts` owns sign/verify.

`hooks.server.ts` populates `locals.teamId`, `locals.isAdmin`, `locals.user`, and `locals.playerId` on every request.

### Svelte 5 runes mode

`svelte.config.js` forces runes mode for all non-library files. Use `$state`, `$derived`, `$effect`, `$props()` throughout — not `writable`, `derived`, or `onMount`-based reactivity for state. `onMount` is still valid for imperative side-effects (e.g. setting up realtime subscriptions).

### Realtime pattern

Browser-side realtime always uses `supabaseBrowser` (anon key). For a table to deliver events to the browser:

1. It must be in the `supabase_realtime` publication.
2. The anon role must have a SELECT policy on it (RLS blocks events otherwise).

Both are set in migrations. See `0010_realtime_publications.sql` for the pattern.

Subscriptions follow this shape:

```typescript
onMount(() => {
	const channel = supabaseBrowser
		.channel('unique-name')
		.on(
			'postgres_changes',
			{ event: 'UPDATE', schema: 'public', table: 'teams', filter: `id=eq.${teamId}` },
			handler
		)
		.subscribe();
	return () => supabaseBrowser.removeChannel(channel);
});
```

### Scoring

All scoring logic lives in `src/routes/(game)/challenge/[id]/+page.server.ts`. Key functions:

- `scoreField()` — per-field scoring. Open-text fields use Levenshtein similarity (≥90% = full points). Year uses falloff (exact=full, ±1=50%, ±2=20%, else=0). Combobox/multiple-choice = exact match.
- `buildFieldResults()` — applies `scoreField` across all variant fields.
- `DEFAULT_INPUT_MODES` — per-variant defaults for which input mode each field uses (combobox / open_text / slider / multiple_choice).
- Field modes can be overridden per-challenge via `challenge.points_config.field_modes` (JSONB).

### Database migrations

Migrations live in `supabase/migrations/` and must be **run manually** in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run). There is no CLI migration runner wired up. Number files sequentially (next is `0035_...sql`). Use `DO $$ BEGIN … EXCEPTION WHEN others THEN null; END $$;` guards around `ALTER PUBLICATION` statements.

### RLS posture

Default: deny all. Explicit policies for each permitted operation. All host writes (scoring, challenge management) go through `createAdminClient()` which bypasses RLS — no write policies needed for admin-only tables. See `0001_initial.sql` for the full baseline policy set.

## Teams

6 teams named after Defqon stage colors: `blue` (Raw), `yellow` (UV), `green` (Mainstage), `red` (Mainstage), `indigo` (Rawstyler), `black` (Freedom). Stored in the `teams` table with `color` as the unique natural key.

## Game variants

| Variant     | Fields                        |
| ----------- | ----------------------------- |
| `normal`    | artist, title, year           |
| `label`     | label, artist, title, year    |
| `anthem`    | festival, artist, title, year |
| `vocal`     | vocal_source, artist, year    |
| `fragments` | title, artist                 |
| `kick`      | artist                        |
| `mashup`    | artist, title                 |
| `battle`    | artist, title, year           |

## Folder structure

```
src/
  lib/
    components/ui/     ← Combobox, MultipleChoice, OpenText, YearInput, Modal
    components/game/   ← (game-specific components)
    server/            ← supabase.ts, team.ts, admin.ts — server-only
    supabase-browser.ts ← singleton browser client
    variants.ts        ← VARIANTS const, getVariantIcon(), getVariantColor() helpers
    types/
      index.ts         ← shared TypeScript types (AnswerField, InputMode, ChallengeResult, …)
      database.ts      ← hand-maintained Supabase row types (regenerate with supabase gen types)
  routes/
    (game)/            ← team-facing pages (no URL segment)
      challenge/[id]/  ← main challenge page + scoring logic
      team/            ← team home (score, position, challenge list)
      join/            ← manual team picker
    admin/             ← host admin (auth-guarded by layout.server.ts)
      sets/            ← game set CRUD (list, create)
        [id]/          ← Gameset Console — inline-editable fields, challenge picker, NFC cards, play-state controls
          lobby/       ← realtime lobby grid (one column per team)
          recap/       ← host-controlled podium reveal sequence
      challenges/[id]/ ← challenge editor (tracks, answer options, input mode picker)
      live/            ← realtime game console (polls /api/auto-submit + /api/player/sweep every 10s)
      review/          ← manual review queue
      pools/           ← combobox answer pool management
      teams/           ← score adjustments + team photo upload
      tracks/          ← track + clip CRUD
      variant-defaults/[variant]/ ← Tier 1 point defaults + streak config per variant
    leaderboard/       ← TV display (realtime)
    nfc/[tag]/         ← NFC tap handler (server route only)
    nfc/randomize/[set_id]/ ← randomizer entry point: joining→assign team, playing→game-in-progress, recap→game-over
    nfc/hint/[challenge_id]/ ← records challenge_hints_used row → redirect to /challenge/[id]?hint=1
    nfc/unlock/[challenge_id]/ ← records challenge_unlocks row (nfc_lock guard) → redirect to /challenge/[id]
    nfc/game-in-progress/[set_id]/ ← placeholder: "game already started" page
    nfc/game-over/[set_id]/ ← placeholder: "game over, view leaderboard" page
    play/[mode]/       ← player onboarding (mode = solo | teams)
      lobby/           ← lobby stub (solo mode only; teams mode goes to /sets)
    play/teams/        ← static routes under teams (higher priority than [mode])
      sets/            ← active game set picker → runs assignTeam → randomizing
      randomizing/     ← CSS animation: rolling → reveal → continue → /team
    api/
      player/
        leave/         ← DELETE player session + photo
        sweep/         ← admin-only: delete expired player sessions
```

## NFC flow

`/nfc/[tag]` resolves the tag's purpose from `nfc_tags` and redirects:

- `team_identity` → sets team cookie → `/team`
- `team_entry` → snake-assigns team via activity_log count → sets cookie → `/team`
- `challenge` → `/challenge/[id]` (redirects to `/join` first if no cookie)

## Key data relationships

- `challenge` → `challenge_tracks` (1–N, ordered by `sort_order`) → `track` + `clip`
- `answer_options` — host-curated multiple-choice options, keyed by `(challenge_id, field)`
- `challenge.points_config` (JSONB) — stores `field_modes` (per-field input mode overrides) and `field_points` (per-field max point overrides)
- `submissions.answers` (JSONB) — player answers keyed by field name
- `review_requests` — linked to `submission_id` + `field_name`; `resolved = false` = pending queue

## Cookie names

- `hitster_team` — player team identity, 7 days
- `hitster_admin` — host session, 24 hours
- `hitster_player` — solo/team onboarding identity (player.id, HMAC-signed), 12 hours. Set by `/play/[mode]` form action. Decoded by `hooks.server.ts` into `locals.playerId`. `$lib/server/player.ts` owns the sign/verify logic.

## Session log

| Date       | Done                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-26 | SvelteKit scaffold, Supabase schema, Vercel link                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-04-26 | Session 3: vertical slice (challenge page, leaderboard, dark theme)                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-04-26 | Session 4: NFC handler, team cookie, /join, /team home                                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-04-29 | Session 5: host admin (login, challenges, tracks, teams, live console)                                                                                                                                                                                                                                                                                                                                                                          |
| 2026-04-29 | Session 5b: display_name on teams (migration 0004), input_mode column (0005)                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-04-29 | Session 6: combobox + open_text input modes, fuzzy scoring, review queue, /admin/pools, /admin/review, accepted_titles                                                                                                                                                                                                                                                                                                                          |
| 2026-04-30 | Session 6b: realtime audit — fixed review_requests/activity_log RLS + publication (migration 0010), results screen live, team home live                                                                                                                                                                                                                                                                                                         |
| 2026-04-30 | Session 7a: multi-track challenges, variant defaults UI, scoring.ts, auto-submit timer (migrations 0011–0013)                                                                                                                                                                                                                                                                                                                                   |
| 2026-05-01 | Session 7a cleanup: per-team challenge attempts replace challenges.started_at (migration 0014); per-attempt admin reset                                                                                                                                                                                                                                                                                                                         |
| 2026-05-02 | Session 8a: audio upload UI — drag-and-drop clip uploader, storage bucket (migrations 0015–0016), search/filter, HTML5 audio players, bulk-delete clips                                                                                                                                                                                                                                                                                         |
| 2026-05-02 | Session 8b: landing page + player identity — three-mode landing (Host/Solo/Teams), player onboarding with name + optional photo, hitster_player cookie, lobby stub, leave/sweep endpoints (migration 0017)                                                                                                                                                                                                                                      |
| 2026-05-02 | Session 8c: game sets + randomizer — game_sets/set_challenges tables (migration 0018), /admin/sets CRUD + challenge picker + NFC card management, /admin/sets/[id]/lobby realtime grid with move-player modal, /play/teams/sets picker, /play/teams/randomizing animation, NFC randomizer tag routing, assignTeam snake-order util                                                                                                              |
| 2026-05-08 | Session A: Supabase Auth (email magic link + Google OAuth), dev test-login bypass, ownership migration (0024, created_by on 8 tables), minimal host dashboard (/admin), host login UI moved to main page (HostAuthForm component), NFC Tags added to sidebar, active/inactive toggle in sets list, Session C polish (collapsible sidebar with localStorage, icons on dashboard tiles, removed stats line)                                       |
| 2026-05-09 | Session B (Game lifecycle): play_state field (joining/playing/recap), Start the game action, status panel 4 states, NFC randomizer split, migration 0025                                                                                                                                                                                                                                                                                        |
| 2026-05-09 | Session B Bug Fixes: panel reactivity (Bug A), end-and-reset clears play_state (Bug B), reactivate set resets scores+attempts (Bug C), tab UI jitter (Bug D), challenges panel compress                                                                                                                                                                                                                                                         |
| 2026-05-10 | Theme system: 4 themes (tactical, led_stage, sound_reactive, max_defqon) + 2 stage themes (mainstage, showtime) + classic = 7 total, switchable via /admin/settings                                                                                                                                                                                                                                                                             |
| 2026-05-10 | Bug pile pass: Classic theme, mobile sidebar drawer (Bug 7), NFC ?next= preservation (Bug 2), inactive-set NFC page (Bug 10), player redirect on game end (Bug 3), TV podium new tab (Bug 4)                                                                                                                                                                                                                                                    |
| 2026-05-10 | Mechanics mega-session: migration 0026 (difficulty_rating, speed_threshold_seconds, hint_text, current_streak, scores_hidden, streak_config, challenge_multiplier), 0027 (team_photos), 0028 (challenge_hints_used). Scoring cascade rewrite. Live bonus tracker, results breakdown animation, leaderboard redesign with photos + streak badge + rank deltas. Team photo upload, collab artist input, waiting room carousel, NFC hint scan flow |
| 2026-05-11 | Set page rebuild: migration 0029 (tutorial_text, nfc_lock_enabled, randomizer_enabled, last_results, challenge_unlocks table). Player state machine (Lobby/Team Console). Tutorial system. NFC lock per challenge. Gameset Console with state-adaptive UI. Reset Game action + Last Results panel. Inline-editable name/description, blur-to-save fields                                                                                        |
| 2026-05-11 | Set page polish: migration 0030 (NFC purpose constraint), Team Console set-scoping, button styling, timer expiry transition, realtime gaps, merged details into console, copy buttons for NFC tag URLs                                                                                                                                                                                                                                          |
| 2026-05-11 | Timer expiry final fix: /api/auto-submit early-return guard removed, NFC lock toggle always-visible with own action, $effect 10s polling while playing                                                                                                                                                                                                                                                                                          |
| 2026-05-12 | Admin parity Batch A: migration 0034 (preset_slug on game_sets), sets list overhaul — "+ Create new gameset" button opens Modal.svelte, category badge per row using preset_slug, URL-bound filter/sort (?preset, ?status, ?sort), empty states (true empty vs filtered empty)                                                                                                                                                                  |
| 2026-05-12 | Admin parity Batch B: duplicateSet action (copies config + set_challenges + set_powerups), duplicateChallenge action (copies config + challenge_tracks + answer_options), Duplicate buttons on /admin/sets/[id] and /admin/challenges/[id], URL-bound filter/sort on /admin/tracks and /admin/challenges, new src/lib/variants.ts (getVariantIcon/getVariantColor), variant icon badges in challenge lists/picker/header, empty states           |

## Technical notes

### Variant helpers

`src/lib/variants.ts` exports: `VARIANTS` (readonly tuple of all 8 variant names), `getVariantIcon(variant)` (returns the lucide-svelte component for that variant), `getVariantColor(variant)` (returns Tailwind classes for a colored badge background/text). Import from `$lib/variants` in any `.svelte` file that needs variant icons or colors.

### game_sets.preset_slug

`preset_slug text` (nullable, migration 0034) — stores a short slug like `'quick_fire'`, `'deep_cuts'`, etc. when a set was created from a preset template. NULL or `'custom'` both mean "no preset / hand-configured". Used in the sets list to show a category badge and for filtering via `?preset=custom`.

### Input mode storage

Stored in `challenge.points_config.field_modes`, not in `answer_options.input_mode`. The `answer_options.input_mode` column (migration 0005) exists but defaults to `multiple_choice` for all rows — do not use it for rendering decisions.

### Scoring module

All scoring logic is in `src/lib/server/scoring.ts`. Key exports: `VARIANT_FIELDS`, `DEFAULT_INPUT_MODES`, `FIELD_POOL_TABLE`, `DEFAULT_FIELD_MAX`, `scoreField`, `buildFieldResults`, `scoreSubmission`. Three-tier point override priority: `challenge.points_config.field_points` > `variant_defaults.points_config.field_points` > `DEFAULT_FIELD_MAX`.

### /api/auto-submit structure

Two independent sections — NEVER let one gate the other:

1. Per-team challenge auto-close (guarded by `if (challenges?.length)`, NOT an early return)
2. Game-set-level timer flip (`play_state → 'recap'`) — always runs unconditionally

The old early return `if (!challenges?.length) return` was the bug: it prevented the game-set check from running when a set had no per-challenge timers.

### NFC lock toggle

Saved via its own `?/toggleNfcLock` action (same pattern as `toggleRandomizer`). NOT part of `setChallenges`. The toggle lives outside the collapsible challenges body so it's always visible regardless of section state or set status. Per-challenge slug inputs (shown when toggle is ON) remain inside the challenges form — they're challenge-level data saved via `setChallenges`.

### Players realtime subscription pattern (set console)

Players are **inserted** without `set_id` (set during `/play/[mode]` onboarding), then **updated** when they join a set. The INSERT subscription filter `set_id=eq.{id}` therefore never fires for new joiners. The correct approach: subscribe to UPDATE with the same filter (Supabase realtime filters on NEW row values, so this fires when `set_id` is assigned). In the UPDATE handler, check the player ID against a `knownPlayerIds` Set (seeded from server-loaded player IDs) to avoid double-counting profile-update events.

### Fuzzy scoring threshold

90% Levenshtein similarity for open_text fields. Configure via `/admin/tracks` accepted_titles if a title variant should pass.

### Pool loading

Combobox pool data is fetched server-side (admin client) in the challenge load function → `data.pools`. Not exposed as a public endpoint.

### submissions.answers format

New format (migration 0012): array of `AnswerArrayEntry` objects `[{ track_id, field_values: {field: value}, scored: {field: score}, total }]`. Old submissions migrated to single-element arrays. Any code reading `answers` must handle both array (new) and plain object (pre-migration).

`answers[0]` also carries an optional `breakdown: ScoreBreakdown` with keys `base, difficulty_multiplier, round_multiplier, comeback_multiplier, streak_bonus, speed_bonus, final` — present on all scored submissions since the Mega Session.

### Multi-track draft state

Player draft stored in `localStorage` keyed `hitster_draft_${teamId}_${challengeId}` as `{trackId: {field: value}}`. Injected as `answers_json` hidden input before form submit. The `{#key activeTrackIndex}` directive forces Combobox to remount on tab switch so saved values display correctly.

### Per-team challenge attempts

`challenge_attempts` (migration 0014) tracks each team's independent timer start. When a team first lands on `/challenge/[id]` (via NFC or direct URL), the server creates an attempt row for that team if the challenge is `status='active'` and no attempt exists yet. The timer deadline is `attempt.started_at + challenge.timer_seconds * 1000`. Client counts down from that; at zero it auto-submits the form.

Admin `/admin/live` polls `/api/auto-submit` every 10s. The endpoint finds attempts where `ended_at IS NULL` and `started_at + timer_seconds < now`, creates empty `is_final=true` submissions for those teams, and sets `attempt.ended_at = now()`. Both normal submission and auto-submit set `ended_at`.

Hosts can reset an individual team's attempt from `/admin/live` (deletes attempt + submission, deducts score). `/admin/teams` "Reset Everything" also clears all attempts.

### is_final flag

`submissions.is_final = true` means no further changes. Set on all submissions (both player-submitted and auto-submitted). Server rejects duplicate submissions with 409.

### Bonus scoring formula (migrations 0026–0028)

`final = round(base × difficulty_multiplier × round_multiplier × comeback_multiplier) + streak_bonus + speed_bonus`

- `difficulty_multiplier = challenge.difficulty_rating / 3` — neutral at 3 (1.0×), max at 5 (1.67×), min at 1 (0.33×)
- `round_multiplier = set_challenges.challenge_multiplier` (1–5×, default 1)
- `comeback_multiplier = 1.5` if `team_score < 0.5 × leader_score` (and base > 0)
- `streak_bonus` — flat pts from highest met threshold in `variant_defaults.streak_config.thresholds` array
- `speed_bonus = 5` if `elapsed_seconds <= challenge.speed_threshold_seconds` (and base > 0)

`computeBreakdown(base, bonusParams)` in `src/lib/server/scoring.ts` returns a `ScoreBreakdown` interface. The breakdown is persisted in `submissions.answers[0].breakdown` and surfaced to the player via the `BonusTracker` component. All bonus params are fetched at submit time in `+page.server.ts` submit action.

### NFC hint scan flow (migration 0028)

`challenge_hints_used(challenge_id, team_id, used_at)` — unique on (challenge_id, team_id). NFC tags with `purpose = 'hint'` route through `/nfc/hint/[challenge_id]` which upserts a hint-used row then redirects to `/challenge/[id]?hint=1`. The challenge page opens a bottom-sheet modal showing `challenge.hint_text` on `?hint=1` arrival. Teams that have scanned see a persistent 💡 Hint button to re-open the modal.

### Team photos

`teams.photo_url` (migration 0027) stores a public URL. Admins upload via `/admin/teams` — uploaded to the `team-photos` Supabase Storage bucket as `{teamId}.{ext}` (max 2 MB, upsert). Photos are shown in the admin teams list, both leaderboard views, and the waiting-room reveal card.

### play_state lifecycle (migration 0025)

`game_sets.play_state` is a text column with CHECK constraint: `joining | playing | recap`. It tracks the sub-phase of an active set independently of `status`:

| play_state | Meaning                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `joining`  | Set is active, players can join via NFC randomizer, game not yet started  |
| `playing`  | Host clicked "Start the game"; no new NFC joins, challenge timers can run |
| `recap`    | Host started recap; podium reveal in progress                             |

Key transitions:

- Toggle activate → `play_state = 'joining'`
- Toggle deactivate → `play_state = 'joining'` (reset for next activation)
- `?/startGame` action → `play_state = 'playing'`
- `?/startRecap` action → `play_state = 'recap'`

NFC randomizer (`/nfc/randomize/[set_id]`) checks play_state **before** player auth: `playing` → redirects to `/nfc/game-in-progress/[set_id]`; `recap` → `/nfc/game-over/[set_id]`.

Dashboard status panel and set page both subscribe to `game_sets` realtime updates and update the UI when play_state changes without a full reload.

### Reset SQL

Two distinct resets — run manually in Supabase SQL Editor.

**Soft reset** — preserves game_sets, set_challenges, challenges, tracks, NFC cards. Use to re-run the same set or start a fresh round without rebuilding configuration.

```sql
-- Clear player sessions
UPDATE players SET set_id = NULL, team_id = NULL WHERE set_id IS NOT NULL;
-- Clear game state
DELETE FROM challenge_attempts;
DELETE FROM challenge_hints_used;
DELETE FROM challenge_unlocks;
DELETE FROM submissions;
DELETE FROM review_requests;
DELETE FROM activity_log;
-- Reset team scores and streaks
UPDATE teams SET score = 0, current_streak = 0;
-- Return sets to joining state (recap_state must use 'pending', not NULL — NULL violates the CHECK)
UPDATE game_sets
SET status = 'inactive',
    play_state = 'joining',
    started_at = NULL,
    ended_at = NULL,
    recap_ranking = '[]'::jsonb,
    recap_reveal_index = 0,
    recap_state = 'pending',
    scores_hidden = false,
    assignment_slots = '[]'::jsonb,
    assignment_index = 0;
```

**Hard reset** — same as soft reset, but also removes randomizer + challenge_unlock NFC cards and all player records. Use when tearing down after an event. Does NOT delete game_sets or set_challenges — configuration is preserved.

```sql
-- Same as soft reset
UPDATE players SET set_id = NULL, team_id = NULL WHERE set_id IS NOT NULL;
DELETE FROM challenge_attempts;
DELETE FROM challenge_hints_used;
DELETE FROM challenge_unlocks;
DELETE FROM submissions;
DELETE FROM review_requests;
DELETE FROM activity_log;
UPDATE teams SET score = 0, current_streak = 0;
UPDATE game_sets
SET status = 'inactive',
    play_state = 'joining',
    started_at = NULL,
    ended_at = NULL,
    recap_ranking = '[]'::jsonb,
    recap_reveal_index = 0,
    recap_state = 'pending',
    scores_hidden = false,
    assignment_slots = '[]'::jsonb,
    assignment_index = 0;
-- Additionally: remove randomizer and challenge_unlock NFC cards (challenge/team cards are permanent)
DELETE FROM nfc_tags WHERE purpose IN ('randomizer', 'challenge_unlock');
-- Remove all player records
DELETE FROM players;
```

## Roadmap (not yet built)

- **Session 7c**: host visibility of in-progress challenges (per-team current activity panel)
- **Session 7d**: team device coordination (realtime sync of draft state, last-writer-wins per field)
- **Session 8b — In-app trim**: upload a longer source (audio/video, screen recording, file or URL), waveform UI to scrub and pick a segment, ffmpeg.wasm to trim client-side, save as clip. Used for: host trimming Spotify recordings, players uploading their own clips for variant 7.
- **Session 8d — Set lifecycle polish**: per-set leaderboard, "set starting" countdown, completed-set archive view, host preview mode for testing. (auto-end set on timer expiry is now done via /api/auto-submit)
- **Future — Solo + sets**: allow solo players to also pick a set so their scores group with other solos in the same set.
- **Session 8d — Solo mode polish**: solo group leaderboard, solo private mode, host preview mode.
- **Future — Persistent player accounts**: optional registration so regulars can keep stats across visits.
- **Session 11 — The Recap polish**: `/admin/sets/[id]/recap` exists; needs podium animation improvements, fastest-answer callouts, and player-side celebrations.

### Game sets — key data relationships (added 8c)

- `game_sets` — a named round/game with status (draft/active/completed), team_count (2–6), optional total_timer_seconds
- `set_challenges` — ordered (position) many-to-many: which challenges belong to a set
- `players.set_id` — current set a player is assigned to (nullable; cleared on set end)
- `players.team_id` — team within the set (cleared alongside set_id on end)
- `nfc_tags.purpose = 'randomizer'` + `nfc_tags.set_id` — NFC card that auto-assigns player to a set
- `assignTeam()` in `src/lib/server/randomize.ts` — lowest-count snake-order; scoped to set's team_count teams
