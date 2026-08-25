-- =============================================================================
-- 0078_team_photos_bucket.sql — M!XUP fase 7A (teamfoto)
--
-- WAT DEZE MIGRATIE DOET
--   1. Legt de storage-bucket `team-photos` vast in SQL: public read, 5 MB
--      limiet, alleen afbeeldingen. Tot nu toe was dit het enige stuk infra dat
--      niet uit de migraties te reproduceren was — 0027 zette alleen de kolom
--      `teams.photo_url` en liet het aanmaken van de bucket aan het Dashboard
--      over.
--   2. Zet de public-read SELECT-policy op storage.objects voor die bucket,
--      hetzelfde patroon als `Public audio read` (0016) en
--      `Public player photo read` (0017), zodat de publieke URL's zonder
--      auth-token werken.
--
-- LET OP — de bucket bestaat op dit moment NIET in dit project (gecontroleerd
-- op 2026-08-25: alleen `Track`, `audio` en `player_photos` staan er). Zonder
-- deze migratie faalt zowel de host-upload op /admin/teams als de nieuwe
-- speler-upload op /team met "Bucket not found".
--
-- IDEMPOTENT: `ON CONFLICT (id) DO UPDATE` maakt de bucket aan als hij er niet
-- is en corrigeert anders alleen de instellingen; de policy staat in een
-- DO-blok met `EXCEPTION WHEN duplicate_object`. Meermaals draaien is veilig
-- en raakt bestaande objecten niet aan.
--
-- Handmatig draaien in de Supabase SQL Editor (Dashboard → SQL Editor).
-- =============================================================================

-- team-photos bucket (public, 5 MB limiet, alleen afbeeldingen)
--
-- Mime-lijst: de client cropt elke foto naar een vierkante JPEG vóór de upload
-- (src/lib/image-crop.ts), dus in de praktijk komt hier image/jpeg binnen. png
-- en webp staan erbij voor de terugvalroute waarin het croppen niet lukt en het
-- originele bestand doorgaat.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-photos',
  'team-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Public read zodat getPublicUrl() werkt zonder auth-token
DO $$ BEGIN
  CREATE POLICY "Public team photo read" ON storage.objects
    FOR SELECT USING (bucket_id = 'team-photos');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
