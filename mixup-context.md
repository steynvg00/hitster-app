# MixUp! — Project Handoff Document

This document is the full context for continuing development of MixUp! in a new Claude chat. Read this first before generating any prompt for Claude Code.

---

## 1. Project overview

**MixUp!** is a web-based party music game built for a 28-person friends weekend in August 2026 (hosted at home, festival-but-homey vibe). Working name; may be revised.

- **Players** join via NFC stickers placed around a villa (one tap = onboarded into a randomized team)
- **Six teams** by default (blue, yellow, green, red, indigo, black) with editable display names
- **Multiple Hitster-style variants** built around guessing artist / title / year / label / festival / vocal source / sound fragments etc.
- **Host runs the show** through an admin panel with live lobby, scoring, and a TV-display recap with olympic-style podium
- **Aesthetic**: hardcore / festival main stage but summery and homey. Originally Defqon-themed, now developing its own identity. Slight chaos is intentional.

---

## 2. Tech stack

- **Frontend / SSR**: SvelteKit (TypeScript, Svelte 5 runes mode forced project-wide)
- **Hosting**: Vercel (free tier, auto-deploys from GitHub `main`)
- **Backend**: Supabase (Postgres + Storage + Realtime + Auth — Auth active for host login since Session A)
- **Styling**: Tailwind CSS (with `typography` and `forms` plugins)
- **Audio**:
  - WaveSurfer.js v7 — waveform display (tracks page + challenge play page)
  - Tone.js — pitch/tempo effects (UI saves but audio chain currently misbehaving)
  - ffmpeg.wasm — client-side audio trim (currently failing with CORS / loader error)
- **Search/match**: fuse.js — combobox fuzzy filter + open-text title scoring
- **Dev agent**: Claude Code (CLI, runs in `~/hitster-app`)
- **Source control**: GitHub (`steynvg00/hitster-app`, private repo)
- **Live URL**: `hitster-app.vercel.app`

---

## 3. Architecture key decisions

### Three Supabase clients — pick the right one

| Client                      | Where used                                                        | Auth context                                       |
| --------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| Anon (browser)              | Client-side queries, realtime subscriptions                       | RLS-restricted, anon role                          |
| Anon (server, with cookies) | SvelteKit `load` functions                                        | RLS-restricted, anon role + user cookie if present |
| Admin / service-role        | Server-only routes, mutations, photo cleanup, auto-submit, sweeps | Bypasses RLS — never expose to browser             |

The admin client lives in `src/lib/server/` which SvelteKit guarantees server-only.

### Auth model

Host auth uses **Supabase Auth** (email magic link + Google OAuth). The admin layout guard (`/admin/+layout.server.ts`) checks `locals.user` (set by `hooks.server.ts`) and redirects to `/admin/login` if absent. A dev test-login bypass is wired for local development.

Player/team identity still uses HMAC-SHA256 signed cookies (COOKIE_SECRET env var):

- `hitster_team` — team identity (legacy NFC team-card flow, still functional)
- `hitster_player` — player session, 12h expiry, contains `session_token`

Decoded into `locals.teamId`, `locals.user`, `locals.playerId` in `hooks.server.ts`.

### Per-team challenge attempts (the `started_at`-on-challenges replacement)

`challenge_attempts(challenge_id, team_id, started_at, ended_at)` with unique constraint on (challenge_id, team_id). Each team has its own timer per challenge. Created on first arrival at the challenge page. Auto-submit and lock are per-attempt, not per-challenge.

`challenges.started_at` was dropped in migration 0014 — never use.

### Submission shape — JSONB array per challenge

`submissions.answers` is a JSONB array of per-track entries:

```
[
  {
    "track_id": "uuid",
    "field_values": { "artist": "...", "title": "...", "year": 2009 },
    "scored": { "artist": 5, "title": 0, "year": 10 },
    "total": 15,
    "breakdown": {                        // present on answers[0] only
      "base": 15, "difficulty_multiplier": 1.33, "round_multiplier": 2,
      "comeback_multiplier": 1.0, "streak_bonus": 3, "speed_bonus": 5, "final": 48
    }
  }
]
```

One row per (challenge_id, team_id). `is_final` is the resubmission lock — once true, server rejects further updates.

### Realtime delivery requirements

For a table to emit events to anonymous browser clients, BOTH must be true:

1. Table is in `supabase_realtime` publication
2. Anon role has SELECT policy on the table

Missing either silently breaks subscriptions. This bit us multiple times.

Currently subscribed: `submissions`, `teams`, `review_requests`, `activity_log`, `challenges`, `challenge_attempts`, `game_sets`, `players` (some + others).

### Storage paths

- **`audio` bucket** (public, lowercase) — canonical clip storage. Path convention: `{track_id}/{clip_type}/{filename}`. Created by migration 0016.
- **`Track` bucket** (capital T) — legacy from manual uploads, contains a few signed-URL clips that still work. Should be merged/deleted eventually.
- **`player_photos` bucket** (public, 5MB limit) — `{session_token}.jpg` keyed. Cleaned up on player leave or session expiry.

### Points hierarchy — three tiers

When scoring a field, the resolution chain:

1. Per-track override on `challenge_tracks`
2. Challenge-level default in `challenges.points_config`
3. Variant default in `variant_defaults.points_config` (Tier 1)
4. Fallback to 0

**Important fix in scoring code**: empty `{}` configs must fall through to next tier, not short-circuit. This was a real bug previously.

---

## 4. Migrations applied (0001 → 0030)

All migrations run **manually via Supabase SQL Editor** — no CLI runner. Files in `supabase/migrations/`.

| #    | Name                   | What                                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 0001 | initial                | 9 base tables (teams, players, tracks, clips, challenges, challenge_tracks, answer_options, submissions, activity_log) + RLS                                                                                                                                                                                             |
| 0002 | nfc_tags               | Seeded NFC tag rows                                                                                                                                                                                                                                                                                                      |
| 0003 | admin_fields           | `challenges.stage_label`, `status`, `points_config`; `tracks.genre`, `subgenre`                                                                                                                                                                                                                                          |
| 0004 | team_display_name      | `teams.display_name`                                                                                                                                                                                                                                                                                                     |
| 0005 | input_mode             | `answer_options.input_mode`                                                                                                                                                                                                                                                                                              |
| 0006 | answer_pools           | 4 pool tables (artists, labels, festivals, vocal_sources) + 20 seeded artists                                                                                                                                                                                                                                            |
| 0007 | accepted_titles        | `tracks.accepted_titles text[]`                                                                                                                                                                                                                                                                                          |
| 0008 | submission_status      | `submissions.status` enum                                                                                                                                                                                                                                                                                                |
| 0009 | review_requests        | New `review_requests` table                                                                                                                                                                                                                                                                                              |
| 0010 | realtime_publications  | Added `activity_log`, `challenges` to publication; added SELECT policies for `review_requests`, `activity_log`                                                                                                                                                                                                           |
| 0011 | variant_defaults       | New `variant_defaults` table, seeded 8 variants                                                                                                                                                                                                                                                                          |
| 0012 | submission_shape       | Migrated `submissions.answers` to JSONB array shape                                                                                                                                                                                                                                                                      |
| 0013 | challenge_timer_state  | Added `challenges.started_at` (later dropped in 0014)                                                                                                                                                                                                                                                                    |
| 0014 | challenge_attempts     | New `challenge_attempts` table; dropped `challenges.started_at`                                                                                                                                                                                                                                                          |
| 0015 | clip_metadata          | `clips.duration` (float), `clips.storage_object_path`                                                                                                                                                                                                                                                                    |
| 0016 | audio_bucket           | Confirmed/created public `audio` bucket, 10MB limit, public SELECT                                                                                                                                                                                                                                                       |
| 0017 | player_identity        | Extended `players` table (display_name, photo_url, session_token, mode, session_expires_at, team_id nullable); `player_photos` bucket                                                                                                                                                                                    |
| 0018 | game_sets              | `game_sets`, `set_challenges`, `players.set_id`, `nfc_tags.set_id`                                                                                                                                                                                                                                                       |
| 0019 | set_randomization      | `expected_player_count`, `assignment_slots` jsonb, `assignment_index` int; created `assign_team_slot()` plpgsql function with SELECT FOR UPDATE                                                                                                                                                                          |
| 0020 | recap_state            | `recap_state`, `recap_ranking`, `recap_reveal_index` on game_sets                                                                                                                                                                                                                                                        |
| 0021 | active_inactive        | Status simplified to `active                                                                                                                                                                                                                                                                                             | inactive` only (dropped draft, completed) |
| 0022 | clip_effects           | `clips.effects` JSONB (pitch + tempo)                                                                                                                                                                                                                                                                                    |
| 0023 | fix_status_default     | `game_sets.status` default changed from `draft` to `inactive`                                                                                                                                                                                                                                                            |
| 0024 | ownership              | `created_by uuid` added to 8 tables (game_sets, challenges, tracks, clips, answer_options, nfc_tags, set_challenges, challenge_tracks)                                                                                                                                                                                   |
| 0025 | play_state             | `game_sets.play_state text NOT NULL DEFAULT 'joining' CHECK IN (joining, playing, recap)`; backfills active→playing                                                                                                                                                                                                      |
| 0026 | bonus_mechanics        | `challenges.difficulty_rating int DEFAULT 3 CHECK 1–5`, `challenges.speed_threshold_seconds int`, `challenges.hint_text text`; `set_challenges.challenge_multiplier int DEFAULT 1`; `game_sets.scores_hidden bool DEFAULT false`; `variant_defaults.streak_config jsonb`; `teams.current_streak int DEFAULT 0`           |
| 0027 | team_photos            | `teams.photo_url text`                                                                                                                                                                                                                                                                                                   |
| 0028 | challenge_hints_used   | New table: `(id, challenge_id, team_id, used_at)`; unique on `(challenge_id, team_id)`; RLS (anon read/insert); added to realtime publication                                                                                                                                                                            |
| 0029 | session_9_features     | `variant_defaults.tutorial_text text`; `game_sets.nfc_lock_enabled bool DEFAULT false`, `randomizer_enabled bool DEFAULT false`, `last_results jsonb`; `challenge_unlocks(id, challenge_id, team_id, set_id, unlocked_at)` table; `nfc_tags.purpose` CHECK extended to include `'challenge_unlock'` (superseded by 0030) |
| 0030 | nfc_purpose_constraint | Fixes `nfc_tags.purpose` CHECK constraint to correctly allow `'challenge_unlock'` — aligns DB with `NfcTagPurpose` TypeScript type added in 0029                                                                                                                                                                         |
| 0034 | set_preset_slug        | `game_sets.preset_slug text` (nullable) — stores a short slug when a set is created from a preset template; NULL or `'custom'` = no preset                                                                                                                                                                               |

---

## 5. Game model

### Teams

- 6 default rows seeded: blue, yellow, green, red, indigo, black
- `display_name` editable per team
- `score` aggregate of all submissions
- `current_streak int` — consecutive correct submissions; incremented on each base>0 result, reset to 0 on wrong
- `photo_url text` — uploaded to `team-photos` bucket by admin; shown in leaderboard, waiting-room reveal card, admin teams list

### Players

- Cookie-identified via `hitster_player`
- `display_name` (required, 2–30 chars), `photo_url` (optional)
- `session_token` (UUID), `session_expires_at` (now + 12h)
- `mode`: `team | solo_group | solo_private`
- `team_id` (nullable for solo), `set_id` (current set)
- Auto-cleaned by `/api/player/sweep` (admin-polled every 10s on `/admin/live`)

### Game Sets

- `team_count` (2–10), `expected_player_count` (nullable)
- `total_timer_seconds` (DB stored as seconds, admin UI displays/accepts minutes)
- `status`: `active | inactive` (only — draft and completed removed in 0021)
- `scores_hidden bool` — when true, score bars are hidden on the player leaderboard (suspense mode); toggled by host from `/admin/live`
- `play_state`: `joining | playing | recap` — sub-phase within an active set (migration 0025)
  - `joining`: set is active, NFC randomizer assigns teams, game not started
  - `playing`: host clicked "Start the game", no new NFC joins
  - `recap`: host started podium reveal
- `recap_state`: `pending | revealing | complete`
- `recap_ranking`, `recap_reveal_index` for podium reveal sequence
- `assignment_slots` (jsonb pre-shuffled team_id list), `assignment_index` (cursor)
- `started_at` (when set activated), `ended_at` timestamps
- `nfc_lock_enabled bool` — when true, each challenge requires the team to scan its NFC unlock tag before playing; toggled from the set console (migration 0029)
- `randomizer_enabled bool` — enables the randomizer flow for this set (migration 0029)
- `last_results jsonb` — snapshot of team rankings captured before a Reset Game action, shown as "Last results" in the console (migration 0029)
- `preset_slug text` (nullable, migration 0034) — slug of the preset template used to create this set; NULL/`'custom'` = hand-configured; shown as a category badge in the sets list

### Challenges

- `variant`: `normal | label | anthem | vocal | fragments | kick | mashup | battle`
- `timer_seconds`, `points_config` (jsonb — field_modes, field_points)
- `difficulty_rating int 1–5` (default 3) — scales final score via `rating/3` multiplier
- `speed_threshold_seconds int` — team earns +5 speed bonus if they submit within this time
- `hint_text text` — shown in a modal when team scans the hint NFC card
- `status`, `is_active`
- Multi-track via `challenge_tracks(challenge_id, track_id, position)`
- Per-challenge input mode overrides in `challenge.points_config.field_modes`

### Submissions

- One row per (challenge_id, team_id), unique
- `answers` JSONB array (see §3); `answers[0].breakdown` carries bonus multiplier details
- `is_final` boolean — locks against resubmission
- `status`: `auto_correct | auto_wrong | review_requested | review_approved | review_rejected`

### NFC tags

- `slug` unique
- `purpose`: `team_identity | team_entry | challenge | randomizer | hint | challenge_unlock`
- Bound to `set_id` (for randomizers), `challenge_id` (for challenge stations and hints), or `team_color` (team-identity cards)
- Randomizer tap behaviour depends on `game_sets.play_state`: joining → assign team; playing → /nfc/game-in-progress; recap → /nfc/game-over
- Hint tap → `/nfc/hint/[challenge_id]` → records usage in `challenge_hints_used` → redirects to `/challenge/[id]?hint=1`

---

## 6. Player flows

1. **Tap NFC randomizer card** (or visit `/play/teams`) → if no `hitster_player` cookie, redirect to `/play/teams` onboarding with `?next=` return URL
2. **Onboarding** at `/play/teams`: name + optional photo (camera or gallery) → `players` row + cookie set → redirect to next URL (or `/play/teams/sets`)
3. **Either**:
   - **NFC randomizer** at `/nfc/randomize/[set_id]`: animated team assignment using shuffled slot list (or fallback to lowest-count team) → land on `/team`
   - **UI flow** at `/play/teams/sets`: pick active set → animation → team
4. **Challenge play**: visit `/challenge/[id]` → attempt created on first arrival → tab row for multi-track → answer fields per `input_mode` → draft answers stored in localStorage keyed by team+challenge → submit (final lock) or auto-submit on timer expiry
5. **Results screen**: per-track breakdown, per-field correct/wrong with fuzzy-match score for open text → "Request manual review" buttons for wrong fields
6. **Live leaderboard** at `/play/leaderboard`: realtime team scores, hidden when set is ending (suspense window)
7. **Set end (recap kickoff)**: `recap_state` flips → players redirect to `/play/waiting` (pulsing animation)
8. **Recap reveal**: when host reveals their team's card, full-screen team-color animation on player phones
9. **Thanks page** at `/play/thanks`: played challenges + per-track breakdown, accessible even after set is inactive

---

## 7. Host flows

- **`/admin/login`** — shared `HOST_PASSWORD`, sets `hitster_admin` cookie (Session A replaces with Supabase Auth + Google)
- **`/admin/tracks`** — CRUD with inline clip upload (drop zone, type tagging, batch upload), URL-bound search/filter/sort (?q, ?genre, ?has_clips, ?sort), bulk delete, per-clip effects ⚙ button, accepted_titles editor; empty states for true-empty and filter-no-results cases
- **`/admin/challenges`** — CRUD with variant picker, URL-bound filter/sort (?q, ?variant, ?status, ?has_tracks, ?sort), variant icon badges per row, JSON points config, input mode picker per (track, field); Duplicate button on each challenge's edit page; empty states
- **`/admin/sets`** — "+ Create new gameset" button opens a Modal; URL-bound filter/sort (?preset, ?status, ?sort); category badge per row using preset_slug; empty states
- **`/admin/sets/[id]`** — set details + challenge picker + NFC cards; "Duplicate" button copies config + set_challenges + set_powerups and redirects to new set; "Start the game →" button appears when play_state=joining; "Game in progress" badge when playing; realtime via game_sets subscription
- **`/admin/sets/[id]/lobby`** — live grid of teams + players, manual move modal, Reset All
- **`/admin/sets/[id]/recap`** — host-controlled reveal sequence; "Reveal next" button cascades through bottom-up; pedestal at top 3 (olympic style: 1st middle/tallest, 2nd left, 3rd right)
- **`/admin/teams`** — per-team score adjustment with required reason → activity_log, per-team reset, "Reset Everything" button
- **`/admin/pools`** — tabbed CRUD for answer pools
- **`/admin/review`** — live review queue, approve (with point award) / reject
- **`/admin/variant-defaults`** — Tier 1 point defaults per variant
- **`/admin/live`** — realtime view: team scores, active challenges with submission status, force-close, activity ticker (last 30 events). Polls `/api/auto-submit` and `/api/player/sweep` every 10s
- **`/sets/[id]/podium`** — TV display (no admin gate but check), mirrors recap reveals in real-time

---

## 8. Audio capabilities

### Track ingestion

- Upload via `/admin/tracks` drop zone (mp3 / wav / ogg / m4a / flac / webm)
- Per-file type tag: `snippet | fragment | kick | vocal | mashup`
- HTML5 audio metadata parsing for duration
- Batch upload to `audio/{track_id}/{clip_type}/{filename}`
- 10MB per-file limit

### Per-clip features

- Inline waveform via WaveSurfer.js (lazy-loaded, click to play, scrub by drag)
- Effects: pitch (semitones, -12 to +12) + tempo (multiplier, 0.5–2.0) stored in `clips.effects` JSONB
- Effects applied at playback time via Tone.js (PitchShift node + playbackRate)

### In-app trim (currently broken)

- Modal opens WaveSurfer + Regions plugin → drag handles to select region
- Saves trimmed clip via ffmpeg.wasm (loaded from unpkg CDN)
- **Error**: `failed to import ffmpeg-core.js` — likely CORS / unpkg cross-origin issue

### Planned clip-type rename (not yet done)

- `snippet` → **`segment`** (large random part of track)
- `fragment` → **`snippet`** (short part)
- Keep `kick`, `vocal`, `mashup`
- Add `misc` (any sound element) and `track` / `full_track` (entire/major part)

---

## 9. Bug pile

### Fixed bugs

| #   | Bug                                       | How fixed                                                                                                             |
| --- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | **End-and-reset deletes set**             | Reset Game action keeps `game_sets` row, transitions to `inactive/joining`; recap page uses separate resetGame action |
| 2   | **NFC randomizer flow regressed**         | `?next=` param preserved through onboarding redirect chain                                                            |
| 3   | **Players don't redirect to thanks page** | Game end triggers redirect to `/play/thanks` via realtime `play_state` subscription                                   |
| 4   | **TV podium in new tab redirects home**   | Podium page accessible without admin auth cookie                                                                      |
| 7   | **Mobile layout broken**                  | Admin sidebar collapses to a drawer on mobile portrait; toggle in header                                              |
| 10  | **Inactive-set NFC tap silent**           | Randomizer tap for inactive set redirects to "no game running" page                                                   |

### Open bugs

| #   | Bug                                    | Symptom                                                                                                                                                |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5   | **Audio effects not applying** ✓ FIXED | Root cause: `createMediaElementSource()` threw `InvalidStateError` when called twice on the same `HTMLAudioElement`. Fixed with a module-level `WeakMap` cache in `Waveform.svelte` (`<script module>`). Pitch/tempo effects now apply correctly. |
| 6   | **ffmpeg trim save fails**             | `failed to import ffmpeg-core.js`. Likely CORS / unpkg cross-origin                                                                                    |
| 8   | **Duplicate slug error link wrong**    | "View existing tag →" goes to `/admin/sets` index instead of the specific set the existing tag is bound to. Partially fixed but still off              |
| 9   | **MP4/MOV screen recordings rejected** | Upload accepts only audio MIME types; screen recordings include video container. Need audio extraction step                                            |

---

## 10. Roadmap

In order. Three sessions for the dashboard arc, then bug pile, then variants, then polish.

### Session A — Auth + minimal dashboard + ownership migration

- Supabase Auth setup: enable email + Google OAuth (skip Apple)
- Replace `HOST_PASSWORD` with Supabase Auth on `/admin/*` routes
- Account ownership migration: `created_by` column on relevant tables, backfill all existing rows to first registered user
- New host dashboard at `/admin`:
  - Library stats line ("47 tracks · 12 challenges · 5 sets")
  - Status panel (handles 2 states for now: "no game running" with quick start, "game in progress" with link to live view)
  - Quick action tiles (fixed order for now): Sets, Challenges, Tracks, NFC Tags, Live, Defaults — each with count badge
  - Top-right: profile avatar + dropdown (Settings, Logout)
- Note: Session A status panel only handles 2 states. Sessions B handles the joining-vs-playing split (4 states total).

### Session B — Game lifecycle (joining vs playing) ✓ COMPLETE

- `play_state` column added to `game_sets` (migration 0025): `joining | playing | recap`
- "Start the game" button on host dashboard and set page — transitions joining→playing
- NFC randomizer splits by play_state: joining→assign, playing→/nfc/game-in-progress, recap→/nfc/game-over
- Placeholder pages: `/nfc/game-in-progress/[set_id]` and `/nfc/game-over/[set_id]`
- Dashboard status panel: 4 states with realtime updates (amber/joining, green/playing, indigo/recap, zinc/idle)
- "Request to join" flow deferred to future session

### Session C — Tile customization + NFC tag manager + dashboard aesthetics

- Drag to reorder tiles; hide/show toggle; persist user preferences
- New `/admin/nfc-tags` page: list ALL nfc_tags (regardless of binding), with type, slug, bound resource, delete button. Resolves the orphan-tag cleanup problem.
- Optional waveform header above status panel (toggle in user settings, default off)
- Dashboard visual styling

### After dashboard arc

- **Bug pile pass** — work through all 10 from §9
- **Mobile layout fix** — sidebar collapse to icons, vertical mode rendering, all admin pages
- **Per-variant points config UI** (was Session 7b) — replace JSON editor with form fields per variant; per-track overrides; negative points capability
- **Remaining variants** — label / anthem / vocal / mashup / fragments-sort / kick. Mostly UI configuration on top of existing infrastructure
- **Theming pass for non-homepage surfaces** — onboarding, lobby, waiting, thanks, TV podium each get their own visual treatment (NOT the homepage 6-variant system; each surface designed individually)
- **Recap polish** — already partially built, polish reveal animations and pedestal
- **Optional features** (any order):
  - Powerups (token economy + ability deck: all-seeing eye, reset other team's challenge, give shot, freeze with tap-to-break, etc.)
  - Public/private/mine tabs on sets and challenges
  - Account stats (host stats, player stats)
  - BPM-based challenge variant
  - Trivia variant (festival photos, DJ descriptions, logo recognition)
  - Silent disco / karaoke variant
  - Custom variant builder
  - Optional NFC-required-to-start on a per-challenge basis (some rooms require physical scan, others don't)
  - Multi-host accounts with sharing via link

### Roadmap additions from creative session (May 2026)

These items came out of a wide-ranging creative direction chat. They are NOT ordered by implementation priority. When picking any of these up, discuss with planning chat first — many need details, some may be scrapped or merged.

#### Legal hardening (BLOCKER for August event — must ship before sharing URL widely)

- **Host whitelist + closed access**: New `host_whitelist (email)` table. Sign-up blocked for unlisted emails (strict mode). Bootstrap super-admin from .env. New `/admin/whitelist` management page. Add `noindex/nofollow` to all routes + permissive `robots.txt`. Players still join anonymously via NFC — they're guests of an event, not public users.

#### Audio mechanics

- **Frequency isolation per clip**: Add `frequency_low` and `frequency_high` to `clips.effects` JSONB. Apply via Web Audio API `BiquadFilterNode` chain at playback time. Powers a new "Frequency Hunt" variant where the audible band narrows or widens as difficulty modifier. Likely requires fixing Bug 5 (Tone.js chain) first OR using native Web Audio independently of Tone.js.
- **Spotify/SoundCloud background music**: Optional ambient playlist during challenges (separate from challenge audio, doesn't reveal songs). DO NOT use Spotify Web Playback SDK (policy violation for games). Use Spotify Embed (`open.spotify.com/embed/playlist/...`) or SoundCloud Widget API. Host curates a public playlist; app embeds it. User settings: on/off toggle, hide metadata toggle, volume.

#### New game modes (15 modes beyond existing 8 variants)

Existing variants (normal, label, anthem, vocal, fragments, kick, mashup, battle) are scoring shapes — what fields you guess. The modes below are flow/structure changes — how the game is played.

**Tier 1 — Core competitive:**

- **Imposter Mode**: One secret team is the "mole". Other teams identify them. +50pts correct ID, -20pts incorrect accusation. Mole's answers are always wrong (or right — configurable). Adds `challenge_attempts.is_imposter` BOOLEAN, optional accusation voting phase per round.
- **Battle Mode (tournament)**: 1v1 head-to-head bracket. Best score advances. Tiebreaker: speed.
- **Relay Race**: One player per challenge, rotating. No team conferencing. Individual spotlight.

**Tier 2 — Strategic:**

- **Blind Auction**: Teams bid 1–50pts before hearing the song. Confidence multiplier. See all bids before deciding.
- **King of the Hill**: Top team gets 2× multiplier next round but harder challenges. Others get slight hint advantage.
- **Sabotage Draft**: Teams draft challenges for opponents before the game.
- **Prophecy Mode**: Predict the next song before playback. +20pts for correct prediction. See others' predictions (psychology layer).

**Tier 3 — Chaos:**

- **Reverse Mode**: 5-second mid-song snippet, no intro. 10-second answer window.
- **Mashup Gauntlet**: 2–3 songs simultaneously or chopped/remixed per challenge.
- **Hot Potato**: Difficulty escalates with each pass; later teams get compensation bonus.
- **Time Crunch**: Time limit shrinks each round (30s → 5s). Speed bonus scales inversely.
- **Conspiracy Mode**: Multiple-choice with wildly absurd wrong answers (host reads them in funny voices).
- **Swap Mode**: Mid-game, one player per team swaps teams. Surprise reshuffling.

**Tier 4 — Role-based/asymmetrical:**

- **DJ Booth**: One team plays DJ (selects songs for others). DJs earn points based on others' accuracy.
- **Saboteur**: One team can veto one answer per round. Others identify them by voting patterns.
- **Mentor**: One team answers first; others see and decide whether to follow. Mentors gain/lose based on whether others follow correctly.

**Tier 5 — Long-form:**

- **Survivor Elimination**: 3 lives per team. Wrong = lose life. 0 = eliminated. Speed bonuses restore lives.
- **Gauntlet**: Best-of-7 or 10. Rank-based scoring per round (10/5/2pts).
- **Campaign Mode**: 3–4 games in a row in different modes. Cumulative score for ultimate winner.

**Tier 6 — Accessibility/chill:**

- **Collaborative Mode**: All teams vs. the difficulty. Cooperative play.
- **Spectrum Mode**: Slider answers (BPM, year, era). Degrees of rightness, no hard wrong.
- **Remix Voting**: Teams vote on challenge variant before playback (original/acoustic/remix/cover/live).

#### Visual identity (deferred to dedicated session)

- **Logo direction**: "Shattered Explosion" wordmark as hero graphic for high-energy contexts (posters, recap, podium). Clean typography fallback (text-only) for app icon, favicon, small layouts.
- **Festival brand palette**: Primary magenta `#FF2DAA`, secondary cyan `#00E5FF`, accent acid yellow `#FFE600`, violet bridge `#7C4DFF`, pyro orange `#FF7F11`, near-black indigo background `#0B0B1F`, ice white text `#E5F2FF`. (Replaces/supplements current Defqon-derived palette; can coexist with team colors.)
- **Dashboard glassmorphic composition**: Deep night-sky base + star particles, laser beam overlays, stage silhouette at lower third, halo behind central UI, glassmorphic cards (`rgba(21,23,46,0.7)` + `backdrop-filter: blur(20px)` + 1px magenta border-glow), arcade headline typography. May replace/extend existing Mainstage theme.

#### Spotify/legal architecture (reference, not implementation)

When/if Spotify integration ships for challenge audio (currently we use uploaded clips):

- Use Hitster pattern: QR codes that deep-link to `open.spotify.com/track/...` (opens user's own Spotify app)
- DO NOT use Spotify Web Playback SDK — Developer Policy §III.2 prohibits games
- Background music via embeds/widget is OK (user's app plays, not your app)

#### Open questions (resolve before implementing)

1. Imposter variant: mole's answers always wrong, always right, or configurable per game?
2. Background music: skip for now, or build minimal embed?
3. Bonus cascade tuning: exact speed bonus value, streak thresholds (currently 3=+1, 5=+3)?
4. Leaderboard reveal: hide scores starting which challenge (last 2? configurable)?
5. Game mode priority: which 3 modes to build first beyond Standard?
6. Frequency isolation: clip-level effect for variety, or new "Frequency Hunt" variant?
7. Whitelist strictness: block sign-up entirely for unlisted, or allow account creation with "pending approval" state?

---

## 11. Visual identity

### Naming

- **MixUp!** — working name, may revise
- Tagline: **"music games for parties"**
- Other names previously considered: Track Attack, Soundstorm, Beat Battle, Track Roulette, Riffraff, Setdrop. Sit with for a few weeks before deciding final.

### Typography

- **Wordmark**: bold condensed sans-serif uppercase (existing — kept)
- **Body / buttons**: **Nunito** (Google Fonts, weight 600 for tagline)

### Homepage background — randomized 1 of 6 per page load

2 stripe directions:

1. Diagonal stripes in team colors, bottom-left → top-right
2. Same, bottom-right → top-left (mirror)

4 flat-poster shape variants: 3. Bouncing bubbles (15 large bubbles, canvas physics) 4. Pulsing scattered (18 circles, scale 0.2 ↔ 1.0, CSS alternate) 5. Fade in/out (18 circles, staggered phase) 6. Slow-rising (14 large circles in lower half, drift up ~38vh and back)

Stripes had opacity removed so colors come through. Old blurry variants (speaker rings, lava lamp blobs, disco ball, bokeh) are commented out (not deleted) in `src/lib/components/HomepageBackground.svelte`. Can be removed cleanly when sure.

### Festival palette tokens (shipped)

Defined in `src/routes/layout.css` under `@theme {}` (Tailwind v4). Seven tokens:
`mixup-magenta (#ff2daa)` · `mixup-cyan (#00e5ff)` · `mixup-yellow (#ffe600)` · `mixup-violet (#7c4dff)` · `mixup-orange (#ff7f11)` · `mixup-night (#0b0b1f)` · `mixup-ice (#e5f2ff)`

Use as Tailwind utility classes: `text-mixup-magenta`, `bg-mixup-night`, `text-mixup-ice/50` etc.

### Per-page treatment principle

Each non-homepage surface gets its OWN treatment, not the homepage 6-variant system. Status:

| Page | Status | Treatment |
| ---- | ------ | --------- |
| `/sets/[id]/podium` | ✓ SHIPPED | Max-saturation spectacle. Night-sky bg + 3 ambient radials. Festival-palette glow rims per pedestal (magenta=1st, cyan=2nd, violet=3rd). Scale + shadow pulse on reveal. 3 states (pending / revealing / complete). |
| `/play/waiting` | ✓ SHIPPED | Ceremonial suspense. 3 slow-drifting ambient blobs, festival color-cycling 3-ring pulse, team-color 1px top stripe, state-aware heading (waiting → reveal card with CSS sparkle rings → post-reveal rank badge). |
| `/play/thanks` | ✓ SHIPPED | Reflective celebration. Single ambient gradient (calmer), team-color stripe + pill, hero score in mixup-yellow, best-moment magenta callout, challenge cards with variant icons + cyan left border, stagger-in animations. |
| Active challenge | — | Minimal — content-first, no ambient decoration |
| Waiting / lobby | — | Atmospheric, calm |
| Admin | — | Utility-first, single accent stripe |

### Colors

- Six team colors (blue, yellow, green, red, indigo, black)
- Black kept intentionally as a "cool edge" against the warmer palette
- Future: full Defqon color palette as optional team colors (easter egg)

---

## 12. Conventions / habits

### SQL reset (in CLAUDE.md)

- **Soft reset** — preserves game_sets, set_challenges, challenges, tracks, NFC cards. Clears: submissions, review_requests, activity_log, challenge_attempts, challenge_hints_used, challenge_unlocks, team scores. Resets game_sets to `inactive/joining`.
- **Hard reset** — same as soft reset, but also removes randomizer + challenge_unlock NFC cards and all player records. Does NOT delete game_sets or set_challenges — configuration is preserved.

Note: `recap_state` must be set to `'pending'` (not NULL) and `recap_ranking` to `'[]'::jsonb` in reset SQL — NULL/missing values violate CHECK constraints.

### Testing rules

- **Player flows**: incognito browser windows. Multiple incognitos for multi-team tests.
- **NFC + mobile**: real phone via local IP (laptop's local network IP, not localhost).
- **Realtime**: side-by-side browser windows, NOT separate tabs (browsers throttle background tabs).
- **Verify ≠ commit**: always walk the verification list before declaring a session complete. Commits exist that contained real bugs.
- **Push at end of every session**: not just commit. Without push, Vercel doesn't redeploy. Add to end-of-session ritual.

### Migrations

- Manually pasted into Supabase SQL Editor (no CLI runner)
- Sequential numbering (0001 → 0030)
- Idempotent where possible (`if not exists`)
- After running, sanity-check via `information_schema.columns` queries

### Secrets

- Never paste service role keys, cookie secrets, or API tokens in chat. Treat anything from `.env`, Supabase API page, or anything labeled "secret" / "service role" as not-shareable.
- Anon keys, public URLs, GitHub repo URLs, error messages, code snippets without literal keys — fine to share.
- Vercel env vars: PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, COOKIE_SECRET, HOST_PASSWORD (replaced in Session A).

### Supabase free tier gotcha

- Pauses free projects after ~1 week of inactivity. One-click restore. Plan to wake the project up week-of the August event.

---

## 13. Where we left off (May 12, 2026)

**Recently shipped (verified):**

- Supabase Auth + ownership migration + minimal dashboard (Session A)
- Game lifecycle state machine (joining/playing/recap)
- Set page rebuild: Gameset Console with inline editing, state-adaptive UI, NFC lock toggle, randomizer toggle, copy buttons
- Tutorial system (per-variant text, lobby + in-challenge access)
- Player state machine (Lobby → Team Console → Results → Thanks)
- Reset Game action + Last Results panel
- Theme system: 7 themes including Mainstage, Showtime, Classic
- 6 of 10 original bugs from §9 fixed
- Admin parity Batch A: sets list overhaul, Modal.svelte, preset_slug (migration 0034), category badges, URL-bound filter/sort, empty states
- Admin parity Batch B: duplicateSet + duplicateChallenge actions, Duplicate buttons, URL-bound filter/sort on tracks + challenges, `src/lib/variants.ts` with icon/color helpers, variant icon badges throughout, empty states
- **Batch D — Bug 11**: deferred challenge_attempt creation; pre-game gate + `startChallenge` form action
- **Batch E — Admin polish**: ActivityFeed.svelte on dashboard (realtime activity_log); recap Highlight Reel (fastest answers); powerup category UI (collapsible + tri-state master toggle)
- **Path X — Bug 5 fix**: Waveform.svelte WeakMap caching; festival palette tokens in @theme; homepage wordmark polish
- **Visual identity theming pass**: `/sets/[id]/podium` (TV spectacle), `/play/thanks` (reflective celebration), `/play/waiting` (ceremonial suspense) — all using festival palette, each with distinct visual treatment

**Pushed but partially unverified (need full walk):**

- Mechanics commits: bonus tracker, results breakdown animation, leaderboard redesign, team photos, collab artists, waiting carousel, NFC hint scan flow (Tier 1 verified, Tier 2 + 3 pending)
- Latest timer expiry fix

**Open from §9 bug pile:**

- Bug 6: ffmpeg trim CORS error
- Bug 8: Duplicate slug error link goes to wrong location
- Bug 9: MP4/MOV screen recordings rejected on upload
- (Bug 5 fixed — see above)

**Highest-priority next moves:**

1. Host whitelist / closed access (BLOCKER for August event)
2. Walk Tier 2+3 verification for mechanics work
3. Address remaining §9 bugs (6, 8, 9)
4. Game mode rollout (Imposter / Battle / Relay — see §10 creative session items)
5. Dashboard glassmorphic composition pass (deferred from visual identity session)

---

## Pick up here — Host whitelist + verification walk
