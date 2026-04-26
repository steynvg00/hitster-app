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

## Session log
| Date       | Done |
|------------|------|
| 2026-04-26 | SvelteKit + TypeScript + Tailwind v4 scaffold; folder structure; TypeScript types; git + GitHub repo created |
| 2026-04-26 | Supabase project + schema migration; Supabase client (public + admin); Vercel project linked |
| 2026-04-26 | Session 3 vertical slice: seed data, challenge page (audio/dropdowns/year/scoring), leaderboard (realtime), dark theme |

## Next session
- Wire up NFC team-identity cookie: read `team_color` from cookie in challenge load, fall back to Red if missing
- Replace hardcoded Red team in `+page.server.ts` load function (TODO comment in place)
- Fix database.ts: run `npx supabase gen types typescript --project-id tyeejaqahrslrpwfozex` and replace the hand-written types (important for accurate FK relationships)
- Swap placeholder audio URL in seed for a real clip
- Test on mobile (Bluetooth speaker flow)
