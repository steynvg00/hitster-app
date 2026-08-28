-- 0082_powerup_acknowledged.sql
--
-- Eén kolom: WANNEER de speler de kaart van deze toekenning gezien heeft.
--
-- ── Waarom ───────────────────────────────────────────────────────────────────
-- De resultaatflow (src/lib/result-flow.ts) bepaalt waar een terugkerende speler
-- landt op één ding: hoeveel team_powerups-rijen van deze challenge nog op
-- 'pending' staan. Dat werkt voor alles wat de speler moet BEWAREN of laten
-- gaan — die keuze houdt de rij op 'pending' tot hij gemaakt is.
--
-- Voor een straf werkt het niet, en dat is precies het gat dat deze kolom dicht.
-- penalty_shot is immediate_use (migratie 0057): materializeAward activeert hem
-- meteen bij het toekennen, en de activatie zet hem direct op 'consumed'. Er is
-- dus nooit een 'pending'-rij, en er valt niets meer op te roepen:
--
--   normale inlevering   de kaart komt uit de terugkeerwaarde van de
--                        submit-action. Sluit de speler de app vóór hij hem
--                        wegtikt, dan is die waarde weg en komt hij nooit terug.
--   auto-submit          er ís geen terugkeerwaarde. /api/auto-submit draait de
--                        volledige scoringspijplijn op een lege inzending —
--                        inclusief het toekennen van de straf — terwijl de
--                        telefoon in iemands zak zit. De speler ziet niets, ooit.
--
-- De straf was daarmee alleen een regel in activity_log. Dat is een administratie
-- van een verplichting die nooit is uitgesproken.
--
-- ── Waarom een kolom en niet de status ───────────────────────────────────────
-- 'consumed' is waar: het effect IS toegepast (de activity_log-regel staat er,
-- de host ziet hem op /admin/live). De straf terugzetten naar 'pending' zou dat
-- ongedaan lijken te maken en zou bovendien de store/lose-keuze aanbieden voor
-- iets waar niets aan te kiezen valt. GEZIEN en TOEGEPAST zijn twee verschillende
-- vragen; ze verdienen twee velden.
--
-- ── Waarom nullable, zonder default ──────────────────────────────────────────
-- NULL betekent "nog niet weggetikt". Elke rij die vóór deze migratie is
-- aangemaakt krijgt dus NULL — en dat is niet erg: de lezer kijkt alleen naar
-- rijen van de challenge die de speler NU open heeft, in de categorie
-- 'punishment'. Van een afgelopen spel staat er niets open dat nog opgeroepen
-- kan worden.
--
-- Alleen straffen worden hierop gelezen. Een prijs blijft de 'pending'-route
-- volgen die al bestond; die is met geen enkele rij van gedrag veranderd.
--
-- Handmatig draaien in de Supabase SQL Editor.

ALTER TABLE team_powerups
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

-- De lezer in de challenge-load: (team, challenge) met acknowledged_at IS NULL.
-- Partieel, want alleen de niet-weggetikte rijen worden ooit opgevraagd.
CREATE INDEX IF NOT EXISTS team_powerups_unacknowledged_idx
  ON team_powerups (team_id, granted_from_challenge_id)
  WHERE acknowledged_at IS NULL;

-- Bestaande rijen van AFGELOPEN spellen niet als "nog te tonen" laten staan.
-- Zonder deze regel zou een team dat vrijdag op een oude challenge terugkomt een
-- strafkaart van weken geleden te zien krijgen. Alles wat nu al bestaat geldt als
-- afgehandeld; vanaf deze migratie telt alleen wat er nieuw bij komt.
UPDATE team_powerups
  SET acknowledged_at = now()
  WHERE acknowledged_at IS NULL;
