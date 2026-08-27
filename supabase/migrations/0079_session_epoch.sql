-- Migratie 0079: sessie-epoch per gameset — spelerscookies laten vervallen bij een reset.
--
-- De reset draait server-side op de host-console en kan de cookies van 28 andere
-- telefoons niet wissen. In plaats daarvan krijgt elke gameset een grens: elke
-- speler- of teamcookie die is uitgegeven VÓÓR deze tijd geldt niet meer. De
-- cookie draagt zijn eigen uitgiftetijd mee in de ondertekende waarde
-- (zie src/lib/server/player.ts en team.ts), dus de controle is één vergelijking
-- zonder extra opzoeking per cookie.
--
-- DEFAULT to_timestamp(0) en niet now(): met now() zou het toevoegen van deze
-- kolom élke bestaande cookie in één klap ongeldig maken, ook zonder dat er
-- ooit een reset is gedraaid. Vanaf 1970 verandert er niets tot de eerste
-- echte reset de grens optilt.

ALTER TABLE game_sets
    ADD COLUMN IF NOT EXISTS player_epoch timestamptz NOT NULL DEFAULT to_timestamp(0);

COMMENT ON COLUMN game_sets.player_epoch IS
    'Speler- en teamcookies uitgegeven vóór dit moment zijn ongeldig. Wordt door resetGameState() op now() gezet.';
