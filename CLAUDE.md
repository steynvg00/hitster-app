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

Host auth uses **Supabase Auth** (email magic link + Google OAuth). The admin layout guard (`/admin/+layout.server.ts`) checks `locals.user` (set by `hooks.server.ts` from the Supabase session) and redirects to `/admin/login` if absent.

Player and team identity still use custom HMAC-SHA256 signed cookies:

- **`hitster_team`** (7 days) — team identity. Set by `/nfc/[tag]` or `/join`. Read by `hooks.server.ts` → `locals.teamId`.
- **`hitster_player`** (48h) — player session. Set by `/play/[mode]` form action. Decoded into `locals.playerId`. `$lib/server/player.ts` owns sign/verify.

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

Migrations live in `supabase/migrations/` and must be **run manually** in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run). There is no CLI migration runner wired up. Number files sequentially (next is `0053_...sql`). Use `DO $$ BEGIN … EXCEPTION WHEN others THEN null; END $$;` guards around `ALTER PUBLICATION` statements.

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
    components/game/   ← BonusTracker, TutorialOverlay, HeldPowerups, PowerupRevealModal
    server/            ← supabase.ts, team.ts, admin.ts, powerups.ts — server-only
    supabase-browser.ts ← singleton browser client
    variants.ts        ← VARIANTS const, getVariantIcon(), getVariantColor() helpers
    types/
      index.ts         ← shared TypeScript types (AnswerField, InputMode, ChallengeResult, …)
      database.ts      ← hand-maintained Supabase row types (regenerate with supabase gen types)
  routes/
    (game)/            ← team-facing pages (no URL segment)
      challenge/[id]/  ← main challenge page + scoring logic
      team/            ← team home (score, position, challenge list, held powerups)
      join/            ← manual team picker
    admin/             ← host admin (auth-guarded by layout.server.ts)
      sets/            ← game set CRUD (list, create)
        [id]/          ← Gameset Console — challenge picker, NFC cards, play-state controls
          lobby/       ← realtime lobby grid
          recap/       ← host-controlled podium reveal sequence
      challenges/[id]/ ← challenge editor (tracks, answer options, input mode picker)
      live/            ← realtime game console (polls /api/auto-submit every 10s)
      review/          ← manual review queue
      pools/           ← combobox answer pool management
      teams/           ← score adjustments + team photo upload
      tracks/          ← track + clip CRUD
      variant-defaults/[variant]/ ← point defaults + streak config per variant
    leaderboard/       ← TV display (realtime)
    nfc/[tag]/         ← NFC tap handler (server route only)
    nfc/hint/[challenge_id]/ ← records challenge_hints_used → redirect to /challenge/[id]?hint=1
    nfc/unlock/[challenge_id]/ ← records challenge_unlocks (nfc_lock guard) → redirect to /challenge/[id]
    nfc/game-in-progress/[set_id]/ ← redirects to /sets/[id]/in-progress
    nfc/game-over/[set_id]/        ← redirects to /sets/[id]/over
    play/[mode]/       ← player onboarding (mode = solo | teams)
      lobby/           ← lobby stub (solo mode only)
    play/teams/        ← static routes (higher priority than [mode])
      sets/            ← active game set picker → assignTeam → randomizing
      randomizing/     ← CSS animation: rolling → reveal → continue → /team
    sets/[id]/
      join/            ← player join page: random mode auto-assigns; selectable mode shows team picker
      in-progress/     ← "game already started" page (play_state = playing)
      over/            ← "game over" page (play_state = recap)
      podium/          ← TV-display podium (no auth gate); realtime recap reveals
    api/
      player/
        leave/         ← DELETE player session + photo
        sweep/         ← admin-only: delete expired player sessions
    play/
      waiting/         ← player holds phone during recap; 3 states (waiting/reveal/post-reveal)
      thanks/          ← player end-of-night summary; accessible after set inactive
```

## NFC flow

`/nfc/[tag]` resolves the tag's purpose from `nfc_tags` and redirects:

- `team_identity` → sets team cookie → `/team`
- `team_entry` → snake-assigns team via activity_log count → sets cookie → `/team`
- `challenge` → `/challenge/[id]` (redirects to `/join` first if no cookie)

## Player join flow

Players reach `/sets/[id]/join` (linked from QR code or host-shared URL). The page behaviour depends on `game_sets.team_selection_mode`:

- `random` — auto-assigns via `assignTeam()` (snake-order, lowest-count), redirects to `/play/teams/randomizing?team={color}`
- `selectable` — shows a team picker grid; capacity gates based on `expected_player_count / team_count`; overflow safety: if all teams are at capacity, smallest team is unlocked so joining is always possible

If `play_state = playing` → redirect `/sets/[id]/in-progress`. If `recap` → `/sets/[id]/over`.

## Key data relationships

- `challenge` → `challenge_tracks` (1–N, ordered by `sort_order`) → `track` + `clip`
- `answer_options` — host-curated multiple-choice options, keyed by `(challenge_id, field)`
- `challenge.points_config` (JSONB) — stores `field_modes` (per-field input mode overrides) and `field_points` (per-field max point overrides)
- `submissions.answers` (JSONB) — player answers keyed by field name
- `review_requests` — linked to `submission_id` + `field_name`; `resolved = false` = pending queue
- `game_sets` — a named round/game with status (draft/active/completed), team_count (2–6), optional total_timer_seconds
- `set_challenges` — ordered (position) many-to-many: which challenges belong to a set
- `players.set_id` / `players.team_id` — current set + team assignment (nullable; cleared on set end)
- `nfc_tags.purpose = 'randomizer'` + `nfc_tags.set_id` — NFC card that auto-assigns player to a set
- `assignTeam()` in `src/lib/server/randomize.ts` — lowest-count snake-order; scoped to set's team_count teams

## Cookie names

- `hitster_team` — player team identity, 7 days
- `hitster_admin` — host session, 24 hours
- `hitster_player` — solo/team onboarding identity (player.id, HMAC-signed), 48 hours (`PLAYER_SESSION_MAX_AGE_SECONDS` in `$lib/server/player.ts` is the single source; `players.session_expires_at` derives from it). Set by `/play/[mode]` form action. Decoded by `hooks.server.ts` into `locals.playerId`. `$lib/server/player.ts` owns the sign/verify logic.

## Session log

| Date       | Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-12 | Path X — Bug 5 fix: Waveform.svelte WeakMap caching for MediaElementAudioSourceNode in `<script module>` prevents double-createMediaElementSource InvalidStateError; festival palette tokens in Tailwind v4 @theme (7 tokens: magenta, cyan, yellow, violet, orange, night, ice); homepage wordmark + tagline polish                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-05-12 | Visual identity theming pass: /sets/[id]/podium (TV spectacle — night-sky bg, ambient radial gradients, festival-palette glow per pedestal position, bounceIn + scale reveal animations, 3 recap states); /play/thanks (reflective celebration — team color stripe, hero score in mixup-yellow, challenge cards with variant icons, best-moment callout, stagger animations); /play/waiting (ceremonial suspense — 3 slow-drifting ambient gradients, festival color-cycling 3-ring pulse, reveal card CSS sparkle rings, post-reveal rank badge)                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-13 | DevNav: floating dev-only navigation drawer (src/lib/components/DevNav.svelte) mounted in +layout.svelte behind import.meta.env.DEV guard; /api/dev/state GET endpoint (403 in prod); terminal aesthetic (mono, dark, lime); 6 collapsible route sections; active-set context block with quick links; dynamic [id] routes resolved via active set or recent-items dropdown; search filter; Cmd+K / Esc / arrow-key nav; localStorage persistence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-14 | Challenge-types redesign (feature/challenge-types-redesign): variant-specific admin editors (StandardEditor, MashupEditor, FragmentsEditor, EffectsEditor) in src/lib/components/admin/challenge-editors/; challenge_tabs multi-tab architecture with challenge_tab_source_tracks + challenge_tab_clips + mashups + mashup_sources; EffectsEditor per-tab FX chain (7 effects — pitch/tempo/lowpass/highpass/bandpass/phaser/flanger, 600 ms debounce fetch auto-save); getSourceTracksForTab() in scoring.ts centralises source-track resolution across all variants; effects variant intro text on player challenge page                                                                                                                                                                                                                                                                                                                              |
| 2026-05-14 | SearchablePicker Svelte 5 timing fix: imperative hidden-input update before requestSubmit() — Svelte 5 defers signal-to-DOM effects as microtasks, so FormData would read the stale value; fix queries the hidden input by name and sets .value directly before the form fires. Affects all SearchablePicker usages (standard/mashup/fragments/effects editors).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-15 | Join consolidation (feature/join-consolidation): replaced NFC randomizer with /sets/[id]/join (random + selectable modes); added team_selection_mode to game_sets; removed randomizer_enabled + NFC randomizer tags; /sets/[id]/in-progress + /sets/[id]/over status pages; selectable team picker with overflow safety when expected_player_count is null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-05-15 | UX papercuts (feature/ux-papercuts): row-click nav on challenges/tracks/sets/pools admin pages; per-clip play button with stop-one-when-another-plays in FragmentsEditor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-05-15 | Powerups P3a (feature/powerups-p3a): migration 0044 (powerup_types, team_powerups, team_effects, 7 catalog types seeded); src/lib/server/powerups.ts (maybeAwardPowerup + resolvePowerupChoice); submit action earns powerup when score ≥ threshold; HeldPowerups.svelte (held cards + realtime + "Activation coming soon" toast); PowerupRevealModal.svelte (1.8s slot-machine settle animation, Store/Lose for holdable, Lose for immediate-use); year slider range 2000–2026. Activation effects stubbed for P3b.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-05-17 | Powerups P3b (feature/powerups-p3b): migration 0047 (source_team_powerup_id FK on team_effects; status CHECK expanded); activatePowerup() in powerups.ts — all 7 types fully implemented (bonus_points/single_event_mult/hard_gaan/shield insert team_effects; time_boost stores consumed effect + client reacts via realtime to add 30s; insurance floor before breakdown; free_answer looks up correct answer + stores consumed reveal); additive-delta multiplier formula replaces chain-multiply; scoring open-text thresholds lowered to 80%/65%; PowerupActivationModal.svelte (effect copy per type, field picker for free_answer, challenge-gate warning); ActiveEffectsBanner.svelte (realtime amber pills, hard_gaan countdown); HeldPowerups click → modal; activatePowerup action on /team and /challenge/[id]; challenge page loads activeEffects + freeAnswerReveal; inline 💡 Revealed badge + draft pre-fill on free_answer activation. |
| 2026-05-17 | Powerups P3c / Crown (feature/powerups-p3c): migration 0048 (crown_payout_applied bool on game_sets); src/lib/server/crown.ts — maybeTransferCrown (+1 steal bonus when team strictly overtakes crown holder, including first-taking; idempotent self-hold guard) + awardCrownPayout (+2 to crown holder at recap, idempotent via crown_payout_applied); both log to activity_log (crown_stolen / crown_payout); hooked into challenge submit action and startRecap admin action; Crown icon (mixup-yellow) shown next to crown holder on /team (banner), /leaderboard (TV), /play/leaderboard, /admin/live (score panel); game_sets realtime subscriptions update crown indicator live; admin/live activityLabel renders ⚔️ crown_stolen and 👑 crown_payout.                                                                                                                                                                                          |
| 2026-08-28 | Host-tools + speler-fixes (feature/host-tools): migratie 0082 (team_powerups.acknowledged_at — NIET gedraaid); src/lib/server/host-tools.ts (adjustTeamScore / grantPowerup / grantExtraTime / resetTeamChallenge / recomputeCrownHolder) met HostToolsSheet.svelte op /admin/live; strafshot verschijnt alsnog na auto-submit én na een gemiste kaart (resumePhase krijgt unseenPenaltyCount); PlayerScreen `flushTop` (top-zone strak onder de dynamic island); $lib/keyboard-inset (toetsenbordmeting zonder visualViewport.offsetTop); maxFragmentsPerSlot begrenst de fragmentchips; uitleg-sheet niet meer dubbelop na de pre-game-poort.                                                                                                                                                                                                                                                                                                         |

## Technical notes

### Festival palette tokens

Defined in `src/routes/layout.css` under `@theme {}` (Tailwind v4 — NOT `tailwind.config.js`). Use as utility classes `text-mixup-magenta`, `bg-mixup-cyan`, `text-mixup-ice/50` etc.:

| Token                   | Hex       | Role                                   |
| ----------------------- | --------- | -------------------------------------- |
| `--color-mixup-magenta` | `#ff2daa` | Primary accent, wordmark, badges       |
| `--color-mixup-cyan`    | `#00e5ff` | Secondary accent, borders, pulse       |
| `--color-mixup-yellow`  | `#ffe600` | Score numbers, highlight callouts      |
| `--color-mixup-violet`  | `#7c4dff` | Tertiary accent, 3rd-place podium glow |
| `--color-mixup-orange`  | `#ff7f11` | Warm accent                            |
| `--color-mixup-night`   | `#0b0b1f` | Page background for all festival pages |
| `--color-mixup-ice`     | `#e5f2ff` | Primary body text on dark backgrounds  |

Pages using this palette: `/` (homepage), `/sets/[id]/podium`, `/play/thanks`, `/play/waiting`.

### Per-page visual treatment

Each player-facing and TV-display surface has its own visual identity — NOT the homepage 6-variant random background system:

- `/sets/[id]/podium` — Night-sky bg, festival-palette glow rims per pedestal (magenta=1st, cyan=2nd, violet=3rd), bounceIn reveal, 3 recap states
- `/play/waiting` — 3 slow-drifting ambient blobs, color-cycling 3-ring pulse, CSS sparkle rings on reveal card, rank badge post-reveal
- `/play/thanks` — Single ambient gradient, team-color stripe, hero score in mixup-yellow, challenge cards with variant icons + stagger animations
- `/leaderboard` — Realtime TV scores
- Active challenge — Minimal, content-first
- Admin — Utility-first, single accent stripe

### Challenge start gate (Bug 11)

`challenge_attempts` rows are **not** created in the load function. On first arrival without an existing attempt, the player sees a pre-game gate (variant icon, tutorial text if set, "Start challenge →" button). The button fires `?/startChallenge` (admin client, `onConflict: 'challenge_id,team_id', ignoreDuplicates: true`). On success, `window.location.reload()` forces a full mount so `onMount` re-initialises the countdown timer from the new `timerEndsAt`.

Template guard order in the challenge page:

```
{#if result}           → results screen
{:else if !data.attempt && data.challenge.status !== 'active'} → challenge ended
{:else if !data.attempt}                                        → pre-game gate
{:else}                                                         → in-game form
```

### Waveform audio source caching

`src/lib/components/ui/Waveform.svelte` uses a module-level `WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>` (in `<script module>`) to cache audio source nodes. The Web Audio API throws `InvalidStateError` if `createMediaElementSource()` is called twice on the same element — even after `disconnect()` — because the browser marks the element as "captured". The `getOrCreateMediaElementSource()` helper prevents this from the `$effect` / WaveSurfer `ready` callback race.

### Variant helpers

`src/lib/variants.ts` exports: `VARIANTS` (readonly tuple of all 8 variant names), `getVariantIcon(variant)` (returns the lucide-svelte component for that variant), `getVariantColor(variant)` (returns Tailwind classes for a colored badge background/text). Import from `$lib/variants` in any `.svelte` file that needs variant icons or colors.

### DevNav — dev-only floating navigation

`src/lib/components/DevNav.svelte` is mounted in the root layout behind `{#if import.meta.env.DEV}`. It **never renders in production** — Vite eliminates the conditional at build time. Do not add production logic to this component.

`/api/dev/state` (GET) returns `{ user, team_cookie, active_set, recent_sets, recent_challenges }`. Returns 403 immediately if `!import.meta.env.DEV`. Uses `createAdminClient()` to bypass RLS.

### SearchablePicker — imperative hidden-input sync

`src/lib/components/admin/SearchablePicker.svelte`'s `select()` function sets the `$bindable` `value` signal and immediately calls `form.requestSubmit()`. In Svelte 5 the signal-to-DOM effect is deferred (microtask), so `new FormData(form)` inside SvelteKit's `use:enhance` submit handler would read the stale hidden-input value if we relied on Svelte's scheduler.

Fix: before calling `requestSubmit()`, imperatively do:

```javascript
const hiddenEl = form.querySelector(`input[type="hidden"][name="${name}"]`) as HTMLInputElement | null;
if (hiddenEl) hiddenEl.value = id;
```

This bypasses the scheduler and ensures FormData always sees the correct value. The form reference is also captured before any state mutations.

### Challenge-tabs architecture (feature/challenge-types-redesign branch)

Admin challenge editor (`/admin/challenges/[id]`) uses a multi-tab model:

- `challenge_tabs` — one row per "slot" in a challenge (position, effects JSONB, mashup_id FK)
- `challenge_tab_source_tracks` — one row per (tab, track) for standard/anthem/label/effects variants
- `challenge_tab_clips` — one row per (tab, clip) for standard/effects; fragment clips use sort_order
- `mashups` + `mashup_sources` — pre-configured mashup objects; mashup tabs reference a mashup by FK

Variant-specific editors live in `src/lib/components/admin/challenge-editors/`:

| Editor            | Variant(s)              | Source of truth for track                                     |
| ----------------- | ----------------------- | ------------------------------------------------------------- |
| `StandardEditor`  | standard, anthem, label | challenge_tab_source_tracks                                   |
| `MashupEditor`    | mashup                  | challenge_tabs.mashup_id → mashups → mashup_sources           |
| `FragmentsEditor` | fragments               | challenge_tab_clips (derived — no explicit source_tracks row) |
| `EffectsEditor`   | effects                 | challenge_tab_source_tracks (same as standard)                |

`getSourceTracksForTab(variant, tab, explicitSources, mashupSources, tabClips, clips, trackMap)` in `src/lib/server/scoring.ts` centralises resolution: mashup → via mashup_sources; fragments → derives from sorted clips; others → from explicitSources filtered by tab_id.

EffectsEditor's FX chain (7 effect cards per tab) auto-saves via `fetch('?/saveTabEffects', ...)` with a 600 ms debounce — NOT a form element, to avoid interfering with the source-track/clip picker forms.

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

Saved via its own `?/toggleNfcLock` action (same pattern as `toggleRandomizer`). NOT part of `setChallenges`. The toggle lives outside the collapsible challenges body so it's always visible regardless of section state or set status.

### Players realtime subscription pattern (set console)

Players are **inserted** without `set_id` (set during `/play/[mode]` onboarding), then **updated** when they join a set. The INSERT subscription filter `set_id=eq.{id}` therefore never fires for new joiners. The correct approach: subscribe to UPDATE with the same filter (Supabase realtime filters on NEW row values, so this fires when `set_id` is assigned). In the UPDATE handler, check the player ID against a `knownPlayerIds` Set (seeded from server-loaded player IDs) to avoid double-counting profile-update events.

### submissions.answers format

New format (migration 0012): array of `AnswerArrayEntry` objects `[{ track_id, field_values: {field: value}, scored: {field: score}, total }]`. Old submissions migrated to single-element arrays. Any code reading `answers` must handle both array (new) and plain object (pre-migration).

`answers[0]` also carries an optional `breakdown: ScoreBreakdown` with keys `base, difficulty_multiplier, round_multiplier, comeback_multiplier, streak_bonus, speed_bonus, final` — present on all scored submissions.

### Multi-track draft state

Player draft stored in `localStorage` keyed `hitster_draft_${teamId}_${challengeId}` as `{trackId: {field: value}}`. Injected as `answers_json` hidden input before form submit. The `{#key activeTrackIndex}` directive forces Combobox to remount on tab switch so saved values display correctly.

### Per-team challenge attempts

`challenge_attempts` (migration 0014) tracks each team's independent timer start. The timer deadline is `attempt.started_at + challenge.timer_seconds * 1000`. Client counts down from that; at zero it auto-submits the form.

Admin `/admin/live` polls `/api/auto-submit` every 10s. The endpoint finds attempts where `ended_at IS NULL` and `started_at + timer_seconds < now`, creates empty `is_final=true` submissions, and sets `attempt.ended_at = now()`. Both normal submission and auto-submit set `ended_at`.

### is_final flag

`submissions.is_final = true` means no further changes. Set on all submissions (both player-submitted and auto-submitted). Server rejects duplicate submissions with 409.

### Bonus scoring formula

`final = round(base × difficulty_multiplier × round_multiplier × comeback_multiplier) + streak_bonus + speed_bonus`

- `difficulty_multiplier = challenge.difficulty_rating / 3` — neutral at 3 (1.0×), max at 5 (1.67×), min at 1 (0.33×)
- `round_multiplier = set_challenges.challenge_multiplier` (1–5×, default 1)
- `comeback_multiplier = 1.5` if `team_score < 0.5 × leader_score` (and base > 0)
- `streak_bonus` — flat pts from highest met threshold in `variant_defaults.streak_config.thresholds` array
- `speed_bonus = 5` if `elapsed_seconds <= challenge.speed_threshold_seconds` (and base > 0)

`computeBreakdown(base, bonusParams)` in `src/lib/server/scoring.ts` returns a `ScoreBreakdown` interface. The breakdown is persisted in `submissions.answers[0].breakdown` and surfaced via the `BonusTracker` component.

### Powerups runtime architecture (P3a/P3b/P3c)

Two parallel powerup table families exist — don't confuse them:

| Family                      | Tables                                           | PK type                   | Purpose                                                |
| --------------------------- | ------------------------------------------------ | ------------------------- | ------------------------------------------------------ |
| Legacy (0032)               | `powerups`, `set_powerups`, `powerup_usages`     | uuid                      | Old catalog + usage log. Not used by P3a earning flow. |
| P3a/P3b runtime (0044/0047) | `powerup_types`, `team_powerups`, `team_effects` | text (types), uuid (rows) | Active earning, storage, and activation.               |

**Earning flow:** after submission scoring, `maybeAwardPowerup()` in `src/lib/server/powerups.ts` checks `game_sets.powerups_enabled` and `powerup_config.earn_threshold` (default 70%). If score% ≥ threshold, picks a random eligible `powerup_types` row and inserts a `team_powerups` row with `status='pending'`. The submit action returns `earnedPowerup: { teamPowerupId, type }` to the client.

**Resolve choices:** `resolveEarnedPowerup` action wraps `resolvePowerupChoice()`. `'store'` → `status='held'` (holdable types only). `'lose'` → `status='lost'`.

**`team_powerups.status`** CHECK: `pending | held | used | lost | active | consumed`. `active` = effect live; `consumed` = single-use effect spent.

**`team_effects`** stores active and consumed effects. Key fields: `effect_type`, `payload` (JSONB), `expires_at` (hard_gaan window), `consumed_at`, `source_team_powerup_id` (FK to team_powerups). Queried by `loadActiveEffects()` (non-consumed rows), consumed by `consumeEffects()` after scoring.

**`activatePowerup()`** in `src/lib/server/powerups.ts` — all 7 types fully live. `bonus_points / single_event_mult / hard_gaan / shield` insert a team_effects row and set status→`active`. `time_boost` inserts a consumed effect (client reacts via realtime INSERT to add 30 s to countdown). `insurance` inserts an active floor effect consumed at submit. `free_answer` looks up the correct answer from the first tab's source track and inserts a consumed reveal effect with `{field, value, challenge_id}`.

**Additive-delta multiplier formula:** `multiplied = round(base × (1 + Σ(m_i − 1)))` — avoids runaway chain-multiply when multiple powerup multipliers stack. Implemented in `computeBreakdown()` in `scoring.ts`.

**`game_sets.powerup_config`** JSONB key used in earning: `earn_threshold` (number, default 70).

### Crown mechanic (P3c)

`game_sets.crown_holder_team_id` — FK to the team currently leading. `game_sets.crown_payout_applied bool` — prevents double-paying the end-game bonus.

**`maybeTransferCrown(admin, setId, teamId, newScore)`** in `src/lib/server/crown.ts` — called after every team score update. Awards **+1 steal bonus** when `newScore > holderScore` (strict). Guards: no-op if team is already the holder; first crown take (no holder + newScore > 0) also awards +1. Logs `crown_stolen` to `activity_log`.

**`awardCrownPayout(admin, setId)`** — called in `startRecap` action. Awards **+2** to whoever holds the crown. Idempotent via `crown_payout_applied`. Logs `crown_payout` to `activity_log`.

**UI:** `Crown` icon from lucide-svelte (`color: #ffe600`) shown next to crown holder on `/team` (banner), `/leaderboard` (TV), `/play/leaderboard`, `/admin/live` (score panel). All four pages subscribe to `game_sets` UPDATE realtime to update `crownHolderTeamId` live.

### NFC hint scan flow

`challenge_hints_used(challenge_id, team_id, used_at)` — unique on (challenge_id, team_id). NFC tags with `purpose = 'hint'` route through `/nfc/hint/[challenge_id]` which upserts a hint-used row then redirects to `/challenge/[id]?hint=1`. The challenge page opens a bottom-sheet modal showing `challenge.hint_text` on `?hint=1`. Teams that have scanned see a persistent Hint button to re-open the modal.

### play_state lifecycle

`game_sets.play_state` is a text column with CHECK constraint: `joining | playing | recap`.

| play_state | Meaning                                                                   |
| ---------- | ------------------------------------------------------------------------- |
| `joining`  | Set is active, players can join via NFC randomizer, game not yet started  |
| `playing`  | Host clicked "Start the game"; no new NFC joins, challenge timers can run |
| `recap`    | Host started recap; podium reveal in progress                             |

Key transitions: activate → `joining`; `?/startGame` → `playing`; `?/startRecap` → `recap`; deactivate → `joining`.

NFC randomizer (`/nfc/randomize/[set_id]`) checks play_state **before** player auth: `playing` → `/nfc/game-in-progress/[set_id]`; `recap` → `/nfc/game-over/[set_id]`.

Dashboard status panel and set page both subscribe to `game_sets` realtime updates.

### Host-ingrepen (feature/host-tools)

Vier ingrepen op `/admin/live` (= de pagina "Game status"), via één "Ingrijpen"-knop per teamkaart en dezelfde ingang vanuit het challenge-raster. Logica in `src/lib/server/host-tools.ts`, UI in `src/lib/components/admin/HostToolsSheet.svelte`, acties op `/admin/live/+page.server.ts`.

| Ingreep     | Functie              | Schrijft                                                                                                                                          |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Punten      | `adjustTeamScore`    | `teams.score` (klemt op `SCORE_ONDERGRENS` = 0), `activity_log` `score_adjustment`                                                                |
| Powerup     | `grantPowerup`       | `team_powerups` — holdable → `held`, immediate_use → `pending` + `activatePowerup()`; `activity_log` `host_powerup_granted`                       |
| Extra tijd  | `grantExtraTime`     | vooraf geconsumeerde `time_boost` in `team_effects` met `{added_seconds, challenge_id, source:'host'}`; `activity_log` `host_time_granted`        |
| Terugzetten | `resetTeamChallenge` | verwijdert submission + attempt, trekt `breakdown.final` af, zet ongebruikte powerups van die challenge op `lost`; `activity_log` `attempt_reset` |

Regels die vastliggen: reden verplicht (afgedwongen in host-tools, niet in de actions), `actor` komt uit `locals.user` en nooit uit het formulier, en geen enkele schrijfquery raakt een ander team — `tests/bots/verify-host-tools.ts` controleert dat structureel op het operatielog.

`recomputeCrownHolder()` vervangt `maybeTransferCrown` na een host-ingreep: geen +1 steelbonus, en hij volgt ook een DALING (na een aftrek kan de houder gezakt zijn zonder dat iemand overneemt).

### Strafshot zichtbaar maken (migratie 0082)

`penalty_shot` is `immediate_use`: bij het toekennen meteen geactiveerd, status `consumed`. De resultaatflow leunde op status `pending` en zag hem daarom nooit — niet na een auto-submit (geen scherm, geen terugkeerwaarde) en niet na een gewone inlevering waarbij de kaart gemist werd.

`team_powerups.acknowledged_at` (migratie 0082) houdt bij of de kaart GEZIEN is; dat is een andere vraag dan of het effect is TOEGEPAST, vandaar een eigen veld en niet de status. `resumePhase(hasPriorResult, pendingCount, unseenPenaltyCount)` zet fase `penalty` vooraan zolang er een onaangetikte straf staat. De load filtert op `acknowledged_at IS NULL` + categorie `punishment`; het wegtikken POST't `?/acknowledgePowerup`.

### Top-zone en toetsenbord op scherm 7B

`PlayerScreen` heeft een stand `flushTop`: `padding-top: max(8px, env(safe-area-inset-top, 0px))` in plaats van de designmarge van 56px. Alleen het antwoordformulier zet hem aan — daar is de bovenzone een instrumentenbalk die tegen de schermrand hoort.

De toetsenbordmeting staat in `src/lib/keyboard-inset.ts`: `innerHeight - visualViewport.height`, **zonder** `offsetTop`. Die verschuiving zet iOS Safari zelf om een gefocust veld boven het toetsenbord te krijgen (deze pagina kan niet scrollen), loopt op met hoe laag het veld staat, en trok de meting onder de 80px-drempel — waardoor de powerup-balk terugkwam bovenop het toetsenbord.

### Reset SQL

Run manually in Supabase SQL Editor. **Soft reset** — preserves game_sets, set_challenges, challenges, tracks, NFC cards:

```sql
UPDATE players SET set_id = NULL, team_id = NULL WHERE set_id IS NOT NULL;
DELETE FROM challenge_attempts;
DELETE FROM challenge_hints_used;
DELETE FROM challenge_unlocks;
DELETE FROM submissions;
DELETE FROM review_requests;
DELETE FROM activity_log;
DELETE FROM team_powerups;
DELETE FROM team_effects;
UPDATE teams SET score = 0, current_streak = 0, held_powerups = '[]'::jsonb, last_threshold_crossed = 0;
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
    assignment_index = 0,
    crown_holder_team_id = NULL,
    crown_payout_applied = false;
```

Hard reset additionally: `DELETE FROM nfc_tags WHERE purpose = 'challenge_unlock'; DELETE FROM players;`
