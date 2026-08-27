-- 0080_challenge_tutorial_text.sql
--
-- Uitlegtekst PER CHALLENGE in plaats van alleen per variant.
--
-- ── Het probleem ────────────────────────────────────────────────────────────
-- `variant_defaults.tutorial_text` is de enige plek waar de "Hoe werkt het"-tekst
-- staat, en die tabel heeft de VARIANT als sleutel. Hitster en Icons draaien
-- allebei op variant = 'standard', dus een tekst die Hitster uitlegt overschrijft
-- die van Icons en andersom. Twee challenges, één tekstveld.
--
-- ── De oplossing ────────────────────────────────────────────────────────────
-- Een eigen nullable kolom op `challenges`. De resolutie is een tweetrapsvalletje,
-- precies zoals hint_text en de drie-traps puntenresolutie in dit project:
--
--   challenges.tutorial_text        (deze kolom, NULL = niet ingevuld)
--   variant_defaults.tutorial_text  (de terugval, ongewijzigd)
--
-- Bestaand gedrag verandert dus niet zolang de kolom NULL is: elke challenge
-- blijft de varianttekst tonen tot een host er een eigen tekst voor schrijft.
-- De code die dit leest staat in de load-functie van
-- src/routes/(game)/challenge/[id]/+page.server.ts.
--
-- Geen RLS-beleid nodig: `challenges` wordt door spelers via de bestaande
-- SELECT-policy gelezen (deze kolom rijdt mee) en door de host geschreven via
-- createAdminClient(), dat RLS omzeilt.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, en twee UPDATEs die dezelfde waarde
-- opnieuw zetten. Veilig om te herhalen.
--
-- Handmatig draaien in de Supabase SQL Editor.

-- ── 1. De kolom ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE challenges ADD COLUMN IF NOT EXISTS tutorial_text text;
EXCEPTION WHEN others THEN null; END $$;

-- ── 2. De twee gevraagde teksten ────────────────────────────────────────────
-- Beide matchen op iets dat de challenge zelf identificeert, niet op een id dat
-- per omgeving verschilt. Controleer de uitkomst na het draaien met de SELECT
-- onderaan; raakt een match meer rijen dan bedoeld, dan is de UPDATE terug te
-- draaien met `SET tutorial_text = NULL` op diezelfde WHERE.

-- Hitster: variant 'standard', herkenbaar aan de titel. Icons draait op dezelfde
-- variant en blijft hierdoor ongemoeid -- dat is precies waarom deze kolom er is.
UPDATE challenges
  SET tutorial_text = 'Hitster zoals je ''m kent — maar dan alleen de leuke stukjes.'
  WHERE variant = 'standard' AND title ILIKE '%hitster%';

-- Fragments: de variant heeft maar één soort challenge, dus de variant zelf is
-- hier de identificatie.
UPDATE challenges
  SET tutorial_text = 'Drie tracks, elk drie clips, door elkaar. Raad de tracks en zet de clips op orde.'
  WHERE variant = 'fragments';

-- ── 3. Controle ─────────────────────────────────────────────────────────────
-- Draai dit na afloop en kijk of de goede rijen een tekst hebben:
--
--   SELECT title, variant, tutorial_text FROM challenges ORDER BY variant, title;
