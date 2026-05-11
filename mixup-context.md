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

| Client | Where used | Auth context |
|---|---|---|
| Anon (browser) | Client-side queries, realtime subscriptions | RLS-restricted, anon role |
| Anon (server, with cookies) | SvelteKit `load` functions | RLS-restricted, anon role + user cookie if present |
| Admin / service-role | Server-only routes, mutations, photo cleanup, auto-submit, sweeps | Bypasses RLS — never expose to browser |

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

| # | Name | What |
|---|---|---|
| 0001 | initial | 9 base tables (teams, players, tracks, clips, challenges, challenge_tracks, answer_options, submissions, activity_log) + RLS |
| 0002 | nfc_tags | Seeded NFC tag rows |
| 0003 | admin_fields | `challenges.stage_label`, `status`, `points_config`; `tracks.genre`, `subgenre` |
| 0004 | team_display_name | `teams.display_name` |
| 0005 | input_mode | `answer_options.input_mode` |
| 0006 | answer_pools | 4 pool tables (artists, labels, festivals, vocal_sources) + 20 seeded artists |
| 0007 | accepted_titles | `tracks.accepted_titles text[]` |
| 0008 | submission_status | `submissions.status` enum |
| 0009 | review_requests | New `review_requests` table |
| 0010 | realtime_publications | Added `activity_log`, `challenges` to publication; added SELECT policies for `review_requests`, `activity_log` |
| 0011 | variant_defaults | New `variant_defaults` table, seeded 8 variants |
| 0012 | submission_shape | Migrated `submissions.answers` to JSONB array shape |
| 0013 | challenge_timer_state | Added `challenges.started_at` (later dropped in 0014) |
| 0014 | challenge_attempts | New `challenge_attempts` table; dropped `challenges.started_at` |
| 0015 | clip_metadata | `clips.duration` (float), `clips.storage_object_path` |
| 0016 | audio_bucket | Confirmed/created public `audio` bucket, 10MB limit, public SELECT |
| 0017 | player_identity | Extended `players` table (display_name, photo_url, session_token, mode, session_expires_at, team_id nullable); `player_photos` bucket |
| 0018 | game_sets | `game_sets`, `set_challenges`, `players.set_id`, `nfc_tags.set_id` |
| 0019 | set_randomization | `expected_player_count`, `assignment_slots` jsonb, `assignment_index` int; created `assign_team_slot()` plpgsql function with SELECT FOR UPDATE |
| 0020 | recap_state | `recap_state`, `recap_ranking`, `recap_reveal_index` on game_sets |
| 0021 | active_inactive | Status simplified to `active|inactive` only (dropped draft, completed) |
| 0022 | clip_effects | `clips.effects` JSONB (pitch + tempo) |
| 0023 | fix_status_default | `game_sets.status` default changed from `draft` to `inactive` |
| 0024 | ownership | `created_by uuid` added to 8 tables (game_sets, challenges, tracks, clips, answer_options, nfc_tags, set_challenges, challenge_tracks) |
| 0025 | play_state | `game_sets.play_state text NOT NULL DEFAULT 'joining' CHECK IN (joining, playing, recap)`; backfills active→playing |
| 0026 | bonus_mechanics | `challenges.difficulty_rating int DEFAULT 3 CHECK 1–5`, `challenges.speed_threshold_seconds int`, `challenges.hint_text text`; `set_challenges.challenge_multiplier int DEFAULT 1`; `game_sets.scores_hidden bool DEFAULT false`; `variant_defaults.streak_config jsonb`; `teams.current_streak int DEFAULT 0` |
| 0027 | team_photos | `teams.photo_url text` |
| 0028 | challenge_hints_used | New table: `(id, challenge_id, team_id, used_at)`; unique on `(challenge_id, team_id)`; RLS (anon read/insert); added to realtime publication |
| 0029 | session_9_features | `variant_defaults.tutorial_text text`; `game_sets.nfc_lock_enabled bool DEFAULT false`, `randomizer_enabled bool DEFAULT false`, `last_results jsonb`; `challenge_unlocks(id, challenge_id, team_id, set_id, unlocked_at)` table; `nfc_tags.purpose` CHECK extended to include `'challenge_unlock'` (superseded by 0030) |
| 0030 | nfc_purpose_constraint | Fixes `nfc_tags.purpose` CHECK constraint to correctly allow `'challenge_unlock'` — aligns DB with `NfcTagPurpose` TypeScript type added in 0029 |

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
- **`/admin/tracks`** — CRUD with inline clip upload (drop zone, type tagging, batch upload), search/filter, bulk delete, per-clip effects ⚙ button, accepted_titles editor
- **`/admin/challenges`** — CRUD with variant picker, JSON points config (planned form replacement in Session 7b), input mode picker per (track, field)
- **`/admin/sets`** — CRUD, toggle active/inactive, per-set lobby + randomizer NFC card management
- **`/admin/sets/[id]`** — set details + challenge picker + NFC cards; "Start the game →" button appears when play_state=joining; "Game in progress" badge when playing; realtime via game_sets subscription
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

## 9. Currently broken — bug pile

Pending bugs not yet addressed. Several are regressions; track each carefully.

| # | Bug | Symptom |
|---|---|---|
| 1 | **End-and-reset deletes set** | After recap "End and reset", `game_sets` row disappears entirely. Should toggle status to `inactive`, not delete. Confirmed: SQL count drops by 1 |
| 2 | **NFC randomizer flow regressed** | Tap → onboarding → continues to `/play/teams/sets` (manual team picker), should go to `/nfc/randomize/[set_id]` for animation. The `?next=` parameter is dropping somewhere |
| 3 | **Players don't redirect to thanks page** | Host clicks End and reset → players stay on results page or wherever they were, no redirect to `/play/thanks` |
| 4 | **TV podium in new tab redirects home** | Right-click → open in new tab → lands on `/` instead of podium. May be auth gate (incognito has no cookie) or realtime channel issue |
| 5 | **Audio effects not applying** | Pitch/tempo sliders save successfully and show amber badge, but playback doesn't sound different. Tone.js audio chain likely not initialized correctly |
| 6 | **ffmpeg trim save fails** | `failed to import ffmpeg-core.js`. Likely CORS / unpkg cross-origin |
| 7 | **Mobile layout broken** | Admin sidebar overlaps content on phone. Confirmed in screenshot. Horizontal mode displays correctly. Only portrait mobile is broken |
| 8 | **Duplicate slug error link wrong** | "View existing tag →" goes to `/admin/sets` index instead of the specific set the existing tag is bound to. Partially fixed but still off |
| 9 | **MP4/MOV screen recordings rejected** | Upload accepts only audio MIME types; screen recordings include video container. Need audio extraction step |
| 10 | **Inactive-set NFC tap silent** | Tap randomizer for inactive/no-active set → redirects to `/` silently. Should show "no game running here" page |

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

4 flat-poster shape variants:
3. Bouncing bubbles (15 large bubbles, canvas physics)
4. Pulsing scattered (18 circles, scale 0.2 ↔ 1.0, CSS alternate)
5. Fade in/out (18 circles, staggered phase)
6. Slow-rising (14 large circles in lower half, drift up ~38vh and back)

Stripes had opacity removed so colors come through. Old blurry variants (speaker rings, lava lamp blobs, disco ball, bokeh) are commented out (not deleted) in `src/lib/components/HomepageBackground.svelte`. Can be removed cleanly when sure.

### Per-page treatment principle
Each non-homepage surface gets its OWN treatment in future sessions, not the homepage 6-variant system:
- TV podium → spectacle, max saturation
- Waiting / lobby → atmospheric, calm
- Active gameplay → minimal, foreground-priority
- Admin → utility-first, single accent stripe

### Colors
- Six team colors (blue, yellow, green, red, indigo, black)
- Black kept intentionally as a "cool edge" against the warmer palette
- Future: full Defqon color palette as optional team colors (easter egg)

---

## 12. Conventions / habits

### SQL reset (in CLAUDE.md)
- **Soft reset** — preserves game_sets, set_challenges, challenges, tracks, NFC cards. Clears: submissions, review_requests, activity_log, challenge_attempts, team scores. Sets challenges back to `is_active = true`.
- **Hard reset** — soft reset PLUS wipes game_sets, set_challenges. Use when tearing down for fresh testing.

Bug previously: soft reset block tried to set `status = 'draft'` which silently violates the new CHECK constraint, causing the UPDATE to no-op. Fixed in commit (Bug B fix).

### Testing rules
- **Player flows**: incognito browser windows. Multiple incognitos for multi-team tests.
- **NFC + mobile**: real phone via local IP (laptop's local network IP, not localhost).
- **Realtime**: side-by-side browser windows, NOT separate tabs (browsers throttle background tabs).
- **Verify ≠ commit**: always walk the verification list before declaring a session complete. Commits exist that contained real bugs.
- **Push at end of every session**: not just commit. Without push, Vercel doesn't redeploy. Add to end-of-session ritual.

### Migrations
- Manually pasted into Supabase SQL Editor (no CLI runner)
- Sequential numbering (0001 → 0023)
- Idempotent where possible (`if not exists`)
- After running, sanity-check via `information_schema.columns` queries

### Secrets
- Never paste service role keys, cookie secrets, or API tokens in chat. Treat anything from `.env`, Supabase API page, or anything labeled "secret" / "service role" as not-shareable.
- Anon keys, public URLs, GitHub repo URLs, error messages, code snippets without literal keys — fine to share.
- Vercel env vars: PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, COOKIE_SECRET, HOST_PASSWORD (replaced in Session A).

### Supabase free tier gotcha
- Pauses free projects after ~1 week of inactivity. One-click restore. Plan to wake the project up week-of the August event.

---

## 13. Where we left off

Just completed:
- **Homepage redesign** — MixUp! wordmark + tagline + Host login button + 6 randomized animated background variants. Old blurry variants commented out for now.

Still pending:
- The full bug pile (§9) — none addressed since the homepage redesign

User decisions for the next phase:
- **Auth providers**: email + Google (no Apple for now)
- **Dashboard scope**: minimal — status panel + quick action tiles, defer recent activity feed and waveform header
- **Existing data ownership**: assign all existing test data to first registered account on login
- **Session split**: 3 sessions (A: auth + minimal dashboard, B: game lifecycle redesign, C: tile customization + NFC tag manager + aesthetics)
- **Mobile layout fix**: deferred until after dashboard arc

---

## Session A complete ✓

- Supabase Auth setup (email magic link working; Google OAuth pending cloud propagation)
- Test login button for local dev
- Ownership migration 0024_ownership (created_by on 8 tables)
- Minimal host dashboard (stats, status panel, 6 quick tiles)
- Quick fixes: NFC Tags in sidebar, active/inactive toggle in set list
- Session C polish: collapsible sidebar, icons on tiles, removed stats line

---

## Session B complete ✓

- Migration 0025: `play_state` column on `game_sets` (`joining | playing | recap`, default `joining`)
- "Start the game →" button on `/admin/sets/[id]` (only in joining phase); disappears once playing; realtime update via `supabaseBrowser` subscription
- Same button inline on admin dashboard (`/admin`) with 4-state status panel (no game / joining / playing / recap), each with appropriate action button and colour scheme; realtime subscription keeps panel live without reload
- NFC randomizer (`/nfc/randomize/[set_id]`) now checks `play_state` **before** player auth:
  - `joining` → assign team as before
  - `playing` → redirect to `/nfc/game-in-progress/[set_id]` ("Game already in progress")
  - `recap` → redirect to `/nfc/game-over/[set_id]` ("Game over, view leaderboard")
- `toggle` deactivation now resets `play_state = 'joining'` so next activation starts fresh
- `startRecap` action now sets `play_state = 'recap'` alongside `recap_state = 'pending'`

---

## Mega Session complete ✓

Migrations 0026–0028 (run manually in Supabase SQL Editor before using new features).

**Bonus scoring**
- `difficulty_rating` (1–5 stars) on challenges; admin UI in `/admin/challenges/[id]`
- `challenge_multiplier` (1–5×) per challenge in a set; set via dropdown in `/admin/sets/[id]`
- Comeback multiplier (1.5×) when team score < 50% of leader
- Streak bonus from `variant_defaults.streak_config.thresholds` (configure in `/admin/variant-defaults/[variant]`)
- Speed bonus (+5 pts) when team submits within `challenge.speed_threshold_seconds`
- `computeBreakdown()` in `src/lib/server/scoring.ts`; breakdown stored in `submissions.answers[0].breakdown`
- `BonusTracker` component shows active pills on challenge page

**Leaderboard redesign**
- Both `/play/leaderboard` and `/leaderboard` (TV) show team avatar (photo or initials), streak badge (🔥N when ≥2), score bar, rank-change arrows (▲/▼N, bounce animation)
- `scores_hidden` on game_sets: when toggled by host from `/admin/live`, score bars disappear from player leaderboard (realtime, no reload)
- Animated score count-up on challenge results (ease-out cubic via RAF)

**Team photos**
- Upload in `/admin/teams` → `team-photos` Supabase Storage bucket
- Shown in admin teams list, both leaderboard views, waiting-room reveal card

**Collab artist input**
- When artist field is in combobox mode, "＋ Add artist" button lets teams stack up to 3 Combobox slots
- Artists joined with " & " before submission — compatible with existing fuzzy scoring

**Waiting room carousel**
- Recap waiting screen shows a "While you wait…" section cycling through all set challenges
- 6s auto-advance, prev/next buttons, dot indicators

**NFC hint scan flow**
- Hint NFC tag (`purpose = 'hint'`) → `/nfc/hint/[challenge_id]` → records `challenge_hints_used` row → redirect to `/challenge/[id]?hint=1`
- Challenge page shows bottom-sheet modal with `hint_text` on first scan
- Re-openable via 💡 Hint button for teams that have already scanned

---

## Session 9 polish complete ✓

Done in the same sitting as Session 9, after the main session doc was written:

- **Migration 0030**: fixed `nfc_tags.purpose` CHECK constraint to allow `'challenge_unlock'` (0029 introduced the type but the constraint was wrong)
- **Team page challenge list**: now scoped to `set_challenges` for the player's current set, ordered by `position`; falls back to all active challenges when player has no set
- **Set console inline editing**: name, description, team count, expected player count, and timer (minutes) are now editable in-place with blur-to-save; shows "saved ✓" flash
- **Realtime toggle sync**: `nfc_lock_enabled` and `randomizer_enabled` propagate into local state via the `game_sets` realtime subscription so toggles stay accurate without reload
- **NFC URL copy buttons**: all three slug locations on `/admin/sets/[id]` (per-challenge unlock inputs, randomizer card rows, add-card input) have a Copy button that writes `{origin}/nfc/{slug}` to clipboard with 1.5s "Copied ✓" flash
- **Button style pass**: "Deactivate set" and "Remove card" converted to proper bordered buttons matching the admin UI style
- **Timer single-shot**: countdown tick calls `/api/auto-submit` once when it hits 0:00 (was later supplemented by the $effect 10s poll in Session 10)

---

## Session 10 complete ✓

**Timer expiry stall fix**: The set page now polls `/api/auto-submit` every 10 seconds via a `$effect` while `play_state = 'playing'`. The endpoint already had the game-set-level timer flip (`play_state = 'recap'`). The `$effect` cleanup cancels the interval when the state changes.

**First-player-join realtime fix**: Players are inserted without `set_id`; it's set via UPDATE when they join. The old INSERT filter (`set_id=eq.{id}`) never fired. Fixed by:
- Returning `playerIds` from the server load
- Seeding `knownPlayerIds = new Set(data.playerIds)` client-side
- The UPDATE handler (which fires because Supabase filters on NEW row values) now increments `livePlayerCount` when a NEW player ID is seen for this set

**Polish shipped**: "Time's up! / Ending game…" copy, End Game confirm text, saved ✓ flash 1.5s, NFC unlock helper text, Reset game scope note.

---

## Session 10b complete ✓

**auto-submit early-return bug**: The endpoint had `if (!challenges?.length) return json({ created: 0 })` which meant the game-set-level timer flip never ran when a set had no per-challenge timers. Fixed by converting the early return to a guarded `if` block, so the game-set check always executes.

**NFC lock toggle**: Moved out of the collapsible challenges body into an always-visible row at the top of the challenges section. Now has its own `?/toggleNfcLock` action (same pattern as randomizer toggle). Removed from `setChallenges` action and form. Per-challenge slug inputs still live inside the challenges form (saved via Save Challenge Order).

---

## Pick up here

**What's solid now (as of Session 10b)**:
- Game timer → auto-end → recap transition works end-to-end (auto-submit polling + game-set flip)
- Set console inline editing, realtime toggles, NFC URL copy buttons all working
- NFC lock toggle is always visible and saves independently
- First-player-join correctly triggers "Start the game" button via realtime UPDATE

**Pending from the bug pile (§9 above)** — none addressed yet:
- **Bug 1**: End-and-reset deletes the game_sets row — high priority, breaks re-use
- **Bug 2**: NFC randomizer `?next=` param dropping — blocks the core onboarding flow
- **Bug 3**: Players don't redirect to thanks page on game end
- **Bug 7**: Mobile layout broken (admin sidebar overlaps on portrait phone)

**Next session options**:
- Bug 1 (end-and-reset) — highest impact, breaks re-use of sets
- Session C — drag-to-reorder dashboard tiles, `/admin/nfc-tags` full list, dashboard aesthetics
- Bug 2 (NFC randomizer `?next=` drop) — blocks core onboarding flow for new players
