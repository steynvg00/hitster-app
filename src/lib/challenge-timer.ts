/**
 * De grenzen en de reken-om van de challenge-timer, op één plek.
 *
 * `challenges.timer_seconds` is een gewone nullable integer — geen CHECK, geen
 * domein, geen trigger. Nagelopen in supabase/migrations: 0001 maakt de kolom
 * (`integer not null default 60`), 0046 haalt NOT NULL en de default eraf, en
 * verder raakt geen enkele migratie hem aan. Het oude plafond van 600 stond dus
 * NERGENS in de database: het was één `max="600"` op het invoerveld in
 * /admin/challenges/[id]. Daarom hoort er bij deze wijziging geen migratie.
 *
 * De waarden staan hier en niet in de twee bestanden die ze gebruiken, omdat het
 * formulier en de serveractie het over dezelfde grenzen moeten hebben: klemt de
 * server op een ander getal dan het veld toelaat, dan slikt "Opslaan" stilletjes
 * een andere timer dan de host intikte.
 */

/** Ondergrens. Onder de tien seconden is een challenge geen challenge meer. */
export const TIMER_MIN_SECONDS = 10;

/**
 * Bovengrens: 60 minuten.
 *
 * De vraag was "minstens 720" (12 minuten). Het is 3600 geworden omdat dat het
 * getal is dat de app al kent als bovenkant van een klok: `total_timer_seconds`
 * van een gameset staat in setPresets.ts op 3600. Zo kan de timer van een losse
 * challenge nooit het ding zijn dat stiekem lager afkapt dan de settimer.
 */
export const TIMER_MAX_SECONDS = 3600;

/** Seconden -> {minuten, seconden}, voor de twee invoervelden. */
export function splitTimer(total: number | null | undefined): { minutes: number; seconds: number } {
	const t = Math.max(0, Math.round(total ?? 0));
	return { minutes: Math.floor(t / 60), seconds: t % 60 };
}

/**
 * {minuten, seconden} -> seconden, geklemd binnen de grenzen hierboven.
 *
 * Niet-getallen tellen als 0, zodat een leeg veld naast een gevuld veld gewoon
 * werkt: "0 min 45 sec" mag je intikken als alleen 45 in het secondenvakje.
 */
export function joinTimer(minutes: unknown, seconds: unknown): number {
	const m = Number(minutes);
	const s = Number(seconds);
	const total = (Number.isFinite(m) ? m : 0) * 60 + (Number.isFinite(s) ? s : 0);
	return Math.min(TIMER_MAX_SECONDS, Math.max(TIMER_MIN_SECONDS, Math.round(total)));
}

/** "12:00" / "45s" — voor lijstjes waar de timer alleen getoond wordt. */
export function formatTimer(total: number | null | undefined): string {
	if (total == null) return '–';
	const { minutes, seconds } = splitTimer(total);
	if (minutes === 0) return `${seconds}s`;
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
