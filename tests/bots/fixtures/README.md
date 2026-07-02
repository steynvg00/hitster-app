# Bot fixtures

Ground-truth answers so the play bots (`npm run bots:play`) can answer
challenges `correct` or `wrong`. One JSON file per test run.

## Shape

```jsonc
{
  "setId": "<game-set-uuid>",        // informational; the run targets --set
  "challenges": [
    {
      "id": "<challenge-uuid>",       // matches /challenge/<id>
      "variant": "standard",          // standard | label | anthem | effects (v1)
      "fields": {
        "artist": "Headhunterz",
        "title": "Dragonborn",
        "year": 2011,
        "record_label": "Scantraxx",  // used for the `label` field
        "festival": "Defqon.1"         // used for the `anthem` festival field
      },
      "accepted_titles": ["Dragonborn"]
    }
  ]
}
```

## Rules

- **No entry for a challenge** the bot plays → it fills **garbage** (unknown track).
- The `label` field reads `fields.record_label`; the `festival` field reads
  `fields.festival`. `year` may be a number or a string.
- Only **single-tab** variants are filled in v1 (`standard`, `label`, `anthem`,
  `effects`). `mashup` / `fragments` / multi-tab challenges are skipped.
- Combobox fields (e.g. `artist`, `label`, `festival` by default) only confirm
  when the exact value exists as a dropdown option — otherwise the bot leaves
  the field blank and logs it. Use values that exist in the answer pools.

## How to fill it in

Get the ids from the host UI or SQL:

```sql
-- the set + its ordered challenges
SELECT sc.position, c.id, c.title, c.variant
FROM set_challenges sc
JOIN challenges c ON c.id = sc.challenge_id
WHERE sc.set_id = '<game-set-uuid>'
ORDER BY sc.position;

-- ground-truth track for a standard challenge (single-tab → single source track)
SELECT t.artist, t.title, t.year, t.record_label, t.festival, t.accepted_titles
FROM challenge_tabs tab
JOIN challenge_tab_source_tracks st ON st.tab_id = tab.id
JOIN tracks t ON t.id = st.track_id
WHERE tab.challenge_id = '<challenge-uuid>';
```

> A DB-driven generator that builds this file automatically from the tracks
> table is **deferred** to a later prompt.
