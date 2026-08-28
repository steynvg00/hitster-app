-- 0081_challenge_tabs_unique_position.sql
--
-- (challenge_id, position) op challenge_tabs wordt UNIEK.
--
-- ── Waarom ────────────────────────────────────────────────────────────────────
-- Migratie 0036 maakte challenge_tabs zonder unieke constraint op de positie.
-- De ?/addTab-actie deed read-max-then-insert. Twee requests die elkaar kruisen
-- (dubbele klik; op de Icons-challenge lagen ze 2 ms uit elkaar, 17 juli 2026)
-- lazen dezelfde max en schreven dezelfde positie. Beide inserts slaagden.
--
-- Dat is niet cosmetisch: het spel keyt concepten en inzendingen op
-- String(tab.position) (challenge-pagina, submit.ts, lifeline, priorResult-
-- rebuild). Twee tabs op één positie delen één concept, dus één van de twee
-- scoort ALTIJD 0 — voor elk team. Op Icons was daardoor 260/300 (86,7 %) het
-- absolute maximum, en de 100 %-trede van de powerup-ladder onbereikbaar.
--
-- ── Wat dit doet ──────────────────────────────────────────────────────────────
--   1. Hernummert bestaande dubbele posities deterministisch (op position,
--      created_at, id) naar 0..N-1 per challenge. Alleen challenges die
--      daadwerkelijk een dubbele hebben worden aangeraakt; een challenge met
--      gaten maar zonder dubbele (Effects: 1..6) blijft zoals hij is — gaten
--      zijn onschadelijk, en hernummeren zou lopende localStorage-concepten van
--      spelers ontkoppelen.
--   2. Voegt de constraint toe. DEFERRABLE INITIALLY IMMEDIATE, zodat een
--      toekomstige herschik-actie posities binnen één transactie kan wisselen
--      (SET CONSTRAINTS ... DEFERRED) zonder eerst via een tussenwaarde te gaan.
--
-- De app-kant (src/lib/server/tabs.ts, createTab) vangt de 23505 die deze
-- constraint bij een race teruggeeft op en probeert met de volgende positie
-- opnieuw. Constraint = correct, retry = bruikbaar; ze horen bij elkaar.
--
-- Idempotent: de hernummering is een no-op zonder dubbelen; de constraint
-- wordt alleen toegevoegd als hij nog niet bestaat.
--
-- LET OP: als een challenge met dubbele posities op dit moment door teams
-- gespeeld wordt, verandert hun tabvolgorde niet (de sortering was al op
-- position; ties krijgen nu een vaste volgorde) maar hun localStorage-concept
-- voor de tabs ná de dubbele schuift één positie op. Draai dit tussen twee
-- spelrondes, niet middenin een challenge.
--
-- Run manually in Supabase SQL Editor.

-- ── 1. Hernummer challenges die een dubbele positie hebben ───────────────────
WITH dup_challenges AS (
  SELECT challenge_id
  FROM challenge_tabs
  GROUP BY challenge_id, position
  HAVING COUNT(*) > 1
),
renumbered AS (
  SELECT
    t.id,
    ROW_NUMBER() OVER (
      PARTITION BY t.challenge_id
      ORDER BY t.position, t.created_at, t.id
    ) - 1 AS new_position
  FROM challenge_tabs t
  WHERE t.challenge_id IN (SELECT challenge_id FROM dup_challenges)
)
UPDATE challenge_tabs t
SET position = r.new_position
FROM renumbered r
WHERE t.id = r.id
  AND t.position IS DISTINCT FROM r.new_position;

-- ── 2. De constraint ─────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE challenge_tabs
    ADD CONSTRAINT challenge_tabs_challenge_id_position_key
    UNIQUE (challenge_id, position)
    DEFERRABLE INITIALLY IMMEDIATE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
