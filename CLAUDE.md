# Hitster App — Project Context

## What this is
A web app for a 28-person, 6-team weekend party game. Core mechanic: Hitster-style music guessing with a Defqon/hard-bass theme. Teams scan NFC stickers placed around a villa to navigate between challenges hosted in different rooms.

## Stack
- **SvelteKit** (frontend + backend API routes) with TypeScript
- **Supabase** — Postgres DB, file storage (audio), realtime subscriptions, auth
- **Vercel** — hosting, deploys from GitHub
- **Tailwind CSS v4** — styling (with @tailwindcss/forms and @tailwindcss/typography)
- **WaveSurfer.js** — audio waveform UI (added later)

## Teams
6 teams named after Defqon stage colors:

| Color  | Stage label          |
|--------|----------------------|
| Blue   | Blue: Raw            |
| Yellow | Yellow: UV           |
| Green  | Green: Mainstage     |
| Red    | Red: Mainstage       |
| Indigo | Indigo: Rawstyler    |
| Black  | Black: Freedom       |

## NFC flow
- 1 NFC **team identity card** per team → sets a team cookie on first scan ("you are Team Red")
- 1–2 NFC **entry cards** → randomize team assignment as people tap in
- Multiple NFC **challenge stickers** per challenge, placed on signs in different rooms → route to the challenge page

Tag routing: `/nfc/[tag]` resolves the tag's purpose from the DB, then redirects.

## Game variants
All variants share a unified data model; only the UI differs per variant.

| Variant      | Description                                                              |
|--------------|--------------------------------------------------------------------------|
| `normal`     | Guess artist, title, year (curated dropdowns + year slider)              |
| `label`      | Guess record label                                                       |
| `anthem`     | Guess festival + standard fields                                         |
| `vocal`      | Guess movie/show the vocal sample is from                                |
| `fragments`  | Sort multiple fragments of one track in the correct order                |
| `kick`       | Hard variant — MC face-grid UI: 8 faces in a row, 5 track slots         |
| `mashup`     | 5 tracks woven into one audio file, guess all 5                          |
| `battle`     | *(stretch)* Head-to-head, closest answer wins                            |

## Core features
- Per-team audio playback (each team has a Bluetooth speaker in their room)
- Host admin view (`/admin`, password-protected) — set up challenges, adjust scores, advance rounds
- Live leaderboard (`/leaderboard`) for a TV display — realtime updates, animated score changes
- Configurable per-challenge timer
- Dropdown answers (host-curated) over free text to avoid typo issues
- Year as a slider; scoring with falloff (correct = X pts, ±1 yr = X−Y, etc.)

## Data model (high level)
See `src/lib/types/index.ts` for TypeScript definitions.

Tables: `teams`, `players`, `tracks`, `clips`, `challenges`, `challenge_tracks`, `answer_options`, `submissions`, `activity_log`, `nfc_tags`

Key relationships:
- A `challenge` has a `variant` and links to one or more `challenge_tracks`
- Each `challenge_track` points to a `track` and a `clip`
- `answer_options` are host-curated dropdown values per challenge + field
- `nfc_tags` map physical tag UIDs to their purpose (team identity / entry / challenge)

## Folder structure
```
src/
  lib/
    components/
      ui/       ← generic: Button, Timer, Modal
      game/     ← game-specific: AudioPlayer, Scoreboard, etc.
    server/     ← server-only: Supabase client, auth helpers
    stores/     ← Svelte stores: team state, game state
    types/      ← shared TypeScript types (index.ts)
  routes/
    (game)/             ← route group (no URL segment), team-facing
      challenge/[id]/   ← main challenge page
    admin/              ← host admin
    leaderboard/        ← TV display
    nfc/[tag]/          ← NFC tap handler (server route)
```

## Build order
1. **Vertical slice** — Normal Hitster end-to-end: NFC tap → team cookie → challenge → audio → dropdowns → submission → score → leaderboard update
2. Other dropdown variants (label, anthem, vocal, mashup)
3. MC face-grid variants (kick, fragments)
4. Theme + polish (Defqon styling, leaderboard animations)
5. Randomizer entry card
6. Stretch: Battle variant, team-built rounds

## NFC sticker URLs
Write these URLs to physical NFC stickers with NFC Tools (or any NFC writer app):

| Sticker purpose       | URL to write                                      |
|-----------------------|---------------------------------------------------|
| Team Blue identity    | `https://<domain>/nfc/team-blue`                  |
| Team Yellow identity  | `https://<domain>/nfc/team-yellow`                |
| Team Green identity   | `https://<domain>/nfc/team-green`                 |
| Team Red identity     | `https://<domain>/nfc/team-red`                   |
| Team Indigo identity  | `https://<domain>/nfc/team-indigo`                |
| Team Black identity   | `https://<domain>/nfc/team-black`                 |
| Round 1 station       | `https://<domain>/nfc/station-mainstage-1`        |
| Randomizer entry card | `https://<domain>/nfc/random-entry`               |

Replace `<domain>` with the Vercel deployment URL (e.g. `hitster-app-xyz.vercel.app`).

To add a new challenge station:
1. Insert a row into `nfc_tags`: `id = 'station-<name>'`, `purpose = 'challenge'`, `challenge_id = <uuid>`
2. Write `https://<domain>/nfc/station-<name>` to the sticker.

## Cookie
- Name: `hitster_team` — httpOnly, `sameSite=lax`, 7-day expiry
- Value: team UUID signed with HMAC-SHA256 (key = `COOKIE_SECRET` env var)
- Set by: `/nfc/[tag]` (team_identity or team_entry tap) or `/join` (manual picker)
- Read by: `hooks.server.ts` → `locals.teamId` (available in every load function)

## Session log
| Date       | Done |
|------------|------|
| 2026-04-26 | SvelteKit + TypeScript + Tailwind v4 scaffold; folder structure; TypeScript types; git + GitHub repo created |
| 2026-04-26 | Supabase project + schema migration; Supabase client (public + admin); Vercel project linked |
| 2026-04-26 | Session 3 vertical slice: seed data, challenge page (audio/dropdowns/year/scoring), leaderboard (realtime), dark theme |
| 2026-04-26 | Session 4 NFC + team identity: cookie helper (HMAC-signed), hooks.server.ts, NFC handler (all 3 tag types), /join picker, /team home, challenge wired to real team, NFC seed migration |
| 2026-04-29 | Session 5 host admin: /admin/login (HOST_PASSWORD), signed host cookie (24h), auth guard, sidebar layout, tracks manager (CRUD + clips), challenges manager (list/create/editor with track picker + answer options), teams manager (score adjustment + reset-all), live console (realtime scores/submissions/activity), migration 0003 (stage_label, status, points_config, genre, subgenre) |
| 2026-04-29 | Session 5b fixes: clip panel error surfacing (bug was silent Supabase query failure), display_name on teams (migration 0004 + edit in /admin/teams + shown everywhere), input_mode on answer_options (migration 0005, data-model only) |
| 2026-04-29 | Session 6: combobox + open text + per-field input modes + manual review queue. Migrations 0006–0009. Combobox/MultipleChoice/OpenText/YearInput components. Dynamic per-field scoring (Levenshtein fuzzy for open_text). Field modes stored in points_config.field_modes. /admin/pools CRUD, /admin/review queue with realtime, /admin/tracks accepted_titles editor, /admin/challenges/[id] input mode picker. |

## Next session
- **Run all pending migrations in Supabase SQL editor (in order):**
  - `0003_admin_fields.sql`, `0004_team_display_name.sql`, `0005_input_mode.sql` (from last sessions)
  - `0006_answer_pools.sql`, `0007_accepted_titles.sql`, `0008_submission_status.sql`, `0009_review_requests.sql` (session 6, new)
- Add `HOST_PASSWORD` to Vercel environment variables (still pending)
- Test full flow in browser: join → challenge → combobox artist pick → open text title → year slider → submit → results with fuzzy %, review request
- Test /admin/pools — verify artist pool seeds loaded (Angerfist etc)
- Test /admin/review — submit a deliberately wrong title, request review, approve from admin
- Test /admin/challenges/[id] input mode picker — set artist=combobox, title=open_text, year=slider and verify it persists
- Add more artists to /admin/pools as you add real tracks
- Add `HOST_PASSWORD` to Vercel env vars, then push and smoke-test on Vercel

## Technical notes (session 6 design decisions)
- **Input mode storage**: stored in `challenge.points_config.field_modes` (not `answer_options.input_mode`). The `answer_options.input_mode` column exists from migration 0005 but is not used for rendering decisions — it defaults to `'multiple_choice'` for all rows (set by migration), which would create ambiguity.
- **Fuzzy scoring threshold**: 90% Levenshtein similarity for open_text fields. A single typo in a ~10-char title still passes. Configure via reviewing/accepting in admin if too strict.
- **Pool loading**: combobox pool data is fetched server-side (admin client) in the challenge load function and passed as `data.pools` — not exposed as a separate public endpoint.

## Future sessions / roadmap

### Session 11 — The Recap
End-of-event celebration screen shown after the game ends. Not yet built — notes only.

**What it shows:**
- Podium animation: 3rd / 2nd / 1st place with team colors, staggered reveal
- Fastest correct answers per challenge (need submission timestamp — already stored in DB)
- Team submissions overview (who answered what, highlight correct ones)
- Per-team photo + optional full-group photo displayed alongside the podium

**Data to preserve / set up before building:**
- Submission timestamps: already in `submissions` table — no schema changes needed
- Per-team photos: need a Supabase Storage bucket (e.g. `team-photos`), one image per team keyed by team ID
- Group photo: optional single upload, could live in the same bucket as `group.jpg`

**Design notes:**
- Route: `/recap` (host triggers, maybe via `/admin`)
- Should be TV-display quality (full-screen, animated, same vibe as `/leaderboard`)
- Keep it stateless — reads from existing `submissions` + `teams` data, no new tables needed beyond photo storage
