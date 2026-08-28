/**
 * DE VIER INGREPEN VAN DE HOST — bijsturen tijdens het spel, zonder database.
 *
 * Vier dingen die tijdens een avond fout kunnen lopen en waar tot nu toe alleen
 * een SQL-editor voor was:
 *
 *   1. punten geven of afnemen        een team is benadeeld, of heeft valsgespeeld
 *   2. een powerup toekennen          een challenge pakte zwaarder uit dan bedoeld
 *   3. extra tijd geven               technisch probleem tijdens een lopende beurt
 *   4. een challenge terugzetten      opnieuw spelen, voor één team
 *
 * ── WAT ELKE INGREEP DEELT ───────────────────────────────────────────────────
 *
 * REDEN VERPLICHT. Elke functie weigert een lege reden. Niet uit administratieve
 * netheid: een ingreep zonder reden is over een uur niet meer te reconstrueren,
 * en de host van vrijdag is dezelfde persoon die zaterdag de uitslag moet kunnen
 * uitleggen.
 *
 * ALLES IN activity_log, met wie, wat, waarom en wanneer. `actor` is het
 * e-mailadres uit de ingelogde host-sessie (locals.user), niet 'host' — er kan
 * meer dan één telefoon op de console staan.
 *
 * NOOIT EEN ANDER TEAM. Elke query hieronder is afgebakend op één team_id. De
 * enige uitzondering is de kroonherberekening, en die LEEST alleen de scores van
 * de andere teams; ze schrijft uitsluitend game_sets.crown_holder_team_id.
 *
 * ── WAAROM DIT EEN EIGEN MODULE IS ───────────────────────────────────────────
 *
 * Als los bestand met de admin-client als eerste argument zijn deze vier tegen
 * de nep-Supabase van de bots te draaien (tests/bots/verify-host-tools.ts). In
 * een form-action zouden ze alleen met een echte database en een echte sessie te
 * controleren zijn — en juist bij ingrepen die scores verplaatsen is "we hebben
 * het één keer geprobeerd" te weinig.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { activatePowerup, type PowerupType } from '$lib/server/powerups';

type AdminClient = SupabaseClient<Database>;

/** Wie de ingreep deed. Uit locals.user; id en e-mail zoals Supabase Auth ze geeft. */
export type HostActor = { id: string | null; email: string | null };

export type Uitkomst<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * De ondergrens van een teamscore.
 *
 * NIET hier bedacht. `?/adjustScore` op /admin/teams klemt al op 0
 * (`Math.max(0, ...)`) en `?/resetTeamAttempt` deed dat ook. Deze constante
 * benoemt die bestaande regel op één plek, zodat de vier ingrepen hieronder hem
 * niet ieder apart kunnen laten verlopen. Een score kan in dit spel nergens
 * onder nul komen; een aftrek die daaronder zou uitkomen stopt op nul.
 */
export const SCORE_ONDERGRENS = 0;

function klem(score: number): number {
	return Math.max(SCORE_ONDERGRENS, score);
}

function schoneReden(raw: unknown): string | null {
	const reden = typeof raw === 'string' ? raw.trim() : '';
	return reden.length > 0 ? reden : null;
}

/** De vaste kop van elke activity_log-payload van een host-ingreep. */
function logKop(reason: string, actor: HostActor) {
	return {
		reason,
		source: 'host_console' as const,
		actor: actor.email ?? actor.id ?? 'unknown'
	};
}

/**
 * DE KROON NA EEN HOST-INGREEP: opnieuw bepalen wie er leidt, zonder bonus.
 *
 * maybeTransferCrown (src/lib/server/crown.ts) is hier bewust NIET de juiste
 * functie. Die deelt +1 steelbonus uit bij een overname, want in het spel is de
 * kroon pakken een prestatie. Een handmatige correctie is dat niet: de host die
 * vijf punten teruggeeft omdat de wifi wegviel, hoort daar geen zesde punt
 * bovenop te krijgen.
 *
 * En het moet ook de ANDERE kant op werken. maybeTransferCrown kan de kroon
 * alleen verplaatsen bij een overname; na een aftrek of een reset kan de houder
 * gezakt zijn zonder dat er iemand "overneemt", en dan zou de kroon blijven
 * staan bij een team dat niet meer leidt — zichtbaar op de TV en op elke
 * telefoon.
 *
 * Bij een gelijke stand blijft de huidige houder staan: er is dan niemand die
 * hem verslagen heeft. Op nul punten voor iedereen staat de kroon bij niemand.
 *
 * Leest de scores van alle teams in de set en schrijft alleen game_sets.
 */
export async function recomputeCrownHolder(db: AdminClient, setId: string): Promise<void> {
	const { data: gs } = await db
		.from('game_sets')
		.select('crown_holder_team_id, team_count')
		.eq('id', setId)
		.maybeSingle();
	if (!gs) return;

	const { data: teams } = await db.from('teams').select('id, score');
	const { data: players } = await db.from('players').select('team_id').eq('set_id', setId);
	const teamsInSet = new Set((players ?? []).map((p) => p.team_id).filter(Boolean));

	// Alleen teams die in deze set spelen. Zonder die afbakening zou een team uit
	// een andere set de kroon kunnen dragen — `teams` is één vaste tabel van zes
	// rijen, niet per set.
	const kandidaten = (teams ?? []).filter((t) => teamsInSet.has(t.id) && (t.score ?? 0) > 0);
	if (kandidaten.length === 0) {
		if (gs.crown_holder_team_id !== null) {
			await db.from('game_sets').update({ crown_holder_team_id: null }).eq('id', setId);
		}
		return;
	}

	const top = Math.max(...kandidaten.map((t) => t.score ?? 0));
	const koplopers = kandidaten.filter((t) => (t.score ?? 0) === top);

	// Draagt de huidige houder nog steeds de topscore, dan verandert er niets —
	// ook niet bij een gedeelde koppositie.
	if (gs.crown_holder_team_id && koplopers.some((t) => t.id === gs.crown_holder_team_id)) return;

	// Bij een gedeelde koppositie zonder zittende houder: de eerste in de vaste
	// teamvolgorde. Willekeurig kiezen zou de kroon bij elke herberekening kunnen
	// laten verspringen.
	const nieuw = koplopers[0].id;
	if (nieuw !== gs.crown_holder_team_id) {
		await db.from('game_sets').update({ crown_holder_team_id: nieuw }).eq('id', setId);
	}
}

// ─── 1. Punten geven of afnemen ──────────────────────────────────────────────

/**
 * Punten optellen bij of aftrekken van één team.
 *
 * De score van andere teams wordt niet aangeraakt; de kroon wordt daarna
 * opnieuw bepaald omdat het KOPLOPERSCHAP wel degelijk kan verschuiven — dat is
 * geen wijziging van een andere score, maar van wie er bovenaan staat.
 *
 * Werkt ook terwijl het team middenin een challenge zit: dit raakt teams.score
 * en verder niets. De lopende challenge_attempt, de timer en het concept in
 * localStorage blijven waar ze zijn, en de score die de inlevering straks
 * oplevert komt er gewoon bovenop.
 */
export async function adjustTeamScore(
	db: AdminClient,
	input: {
		teamId: string;
		setId: string | null;
		delta: number;
		reason: string;
		actor: HostActor;
	}
): Promise<Uitkomst<{ oldScore: number; newScore: number; clamped: boolean }>> {
	const reden = schoneReden(input.reason);
	if (!reden) return { ok: false, error: 'Een reden is verplicht.' };
	if (!Number.isInteger(input.delta) || input.delta === 0) {
		return { ok: false, error: 'Vul een heel aantal punten in, niet 0.' };
	}

	const { data: team } = await db
		.from('teams')
		.select('score, display_name')
		.eq('id', input.teamId)
		.maybeSingle();
	if (!team) return { ok: false, error: 'Team niet gevonden.' };

	const oldScore = team.score ?? 0;
	const ongeklemd = oldScore + input.delta;
	const newScore = klem(ongeklemd);

	const { error: updErr } = await db
		.from('teams')
		.update({ score: newScore })
		.eq('id', input.teamId);
	if (updErr) return { ok: false, error: updErr.message };

	await db.from('activity_log').insert({
		event_type: 'score_adjustment',
		team_id: input.teamId,
		payload: {
			...logKop(reden, input.actor),
			delta: input.delta,
			old_score: oldScore,
			new_score: newScore,
			// Alleen waar als de ondergrens daadwerkelijk heeft ingegrepen — dan is er
			// minder afgetrokken dan de host intikte, en dat hoort in het log te staan.
			clamped: ongeklemd < SCORE_ONDERGRENS
		}
	} as never);

	if (input.setId) await recomputeCrownHolder(db, input.setId);

	return { ok: true, oldScore, newScore, clamped: ongeklemd < SCORE_ONDERGRENS };
}

// ─── 2. Powerup toekennen ────────────────────────────────────────────────────

/**
 * Wat er met een type gebeurt als de host het toekent. Bepaalt de tekst die de
 * console vóór de bevestiging toont, en is dus geen implementatiedetail maar de
 * waarschuwing zelf.
 */
export type ToekenningsGedrag = 'in_voorraad' | 'vuurt_direct';

export function toekenningsGedrag(type: {
	immediate_use: boolean;
	holdable: boolean;
}): ToekenningsGedrag {
	return type.immediate_use ? 'vuurt_direct' : 'in_voorraad';
}

/**
 * Een powerup aan een team geven.
 *
 * TWEE UITKOMSTEN, en welke het wordt bepaalt het TYPE, niet deze functie:
 *
 *   holdable        -> status 'held'. Meteen bruikbaar, precies zoals een
 *                      verdiende powerup die het team bewaard heeft. Hij
 *                      verschijnt via realtime in de powerup-balk op de telefoon.
 *   immediate_use   -> status 'pending', gevolgd door activatePowerup(). Dat is
 *                      exact het pad van materializeAward() bij een verdiende
 *                      powerup — hetzelfde effect, dezelfde logregels.
 *
 * WAAROM 'held' EN NIET 'pending' VOOR EEN HOLDABLE. Een verdiende powerup staat
 * op 'pending' tot de speler bewaren of laten gaan kiest, en die kaart komt
 * binnen via de challenge waarop hij verdiend is. Een toekenning van de host
 * hangt aan geen enkele challenge (granted_from_challenge_id is null), dus die
 * kaart zou nooit ergens opkomen en de powerup zou eeuwig op 'pending' blijven
 * staan — onzichtbaar en onbruikbaar. 'held' is de enige stand die doet wat de
 * host bedoelt: het team heeft hem.
 *
 * WAT EEN immediate_use-TOEKENNING BETEKENT, per type — dit is de kant die de
 * host vóór het bevestigen moet weten:
 *
 *   bonus_points        zet +5 klaar voor de volgende inlevering
 *   lucky_dice          gooit NU en zet de punten direct op de teamscore
 *   hard_gaan           start het x-venster van 15 minuten NU
 *   single_event_mult   rolt de vermenigvuldiger voor de volgende challenge
 *   power_spin          draait het wiel SERVER-SIDE en kent de prijs toe. De
 *                       speler ziet de wielanimatie niet — die hoort bij het
 *                       verdienen. Hij krijgt alleen de uitkomst.
 *   penalty_shot        legt een strafshot op. Sinds migratie 0082 blijft die
 *                       staan tot de speler hem wegtikt, maar alleen op de
 *                       challenge waarop hij is toegekend — een losse toekenning
 *                       door de host heeft die challenge niet en landt daarom
 *                       alleen in activity_log, op het scherm van de host.
 *
 * De console toont die regel bij het gekozen type, vóór de bevestiging — zie
 * HOST_GRANT_EFFECT in HostToolsSheet.svelte. Bewust niet in $lib/powerups-copy:
 * dat bestand is speler-copy, en dit is een waarschuwing aan de host.
 */
export async function grantPowerup(
	db: AdminClient,
	input: {
		teamId: string;
		setId: string;
		typeId: string;
		reason: string;
		actor: HostActor;
	}
): Promise<Uitkomst<{ teamPowerupId: string; gedrag: ToekenningsGedrag; activated: boolean }>> {
	const reden = schoneReden(input.reason);
	if (!reden) return { ok: false, error: 'Een reden is verplicht.' };

	const { data: type } = await db
		.from('powerup_types')
		.select('*')
		.eq('id', input.typeId)
		.maybeSingle();
	if (!type) return { ok: false, error: 'Onbekend powerup-type.' };

	const t = type as PowerupType;
	if (t.coming_soon) {
		return { ok: false, error: `${t.name} is nog niet gebouwd en kan niets doen.` };
	}

	const gedrag = toekenningsGedrag(t);

	const { data: inserted, error: insErr } = await db
		.from('team_powerups')
		.insert({
			team_id: input.teamId,
			set_id: input.setId,
			powerup_type_id: t.id,
			granted_from_challenge_id: null,
			status: gedrag === 'vuurt_direct' ? 'pending' : 'held'
		} as never)
		.select('id')
		.single();
	if (insErr || !inserted) return { ok: false, error: insErr?.message ?? 'Toekennen mislukt.' };

	let activated = false;
	let activationError: string | null = null;
	if (gedrag === 'vuurt_direct') {
		const res = await activatePowerup(db, inserted.id, { allowFromPending: true });
		activated = res.success;
		if (!res.success) activationError = res.error ?? 'onbekende fout';
	}

	// Een eigen event_type, want dit MOET van een verdiende powerup te
	// onderscheiden zijn: in het log, in de balans-analyse achteraf, en straks in
	// elke discussie over waarom een team die kaart had.
	await db.from('activity_log').insert({
		event_type: 'host_powerup_granted',
		team_id: input.teamId,
		payload: {
			...logKop(reden, input.actor),
			powerup_type_id: t.id,
			powerup_name: t.name,
			immediate_use: t.immediate_use,
			status: gedrag === 'vuurt_direct' ? 'pending→consumed' : 'held',
			activated,
			...(activationError ? { activation_error: activationError } : {})
		}
	} as never);

	return { ok: true, teamPowerupId: inserted.id, gedrag, activated };
}

// ─── 3. Extra tijd geven ─────────────────────────────────────────────────────

/** Grenzen aan wat de host in één keer kan bijgeven. */
export const EXTRA_TIJD_MIN_SECONDEN = 5;
export const EXTRA_TIJD_MAX_SECONDEN = 600;

/**
 * Extra seconden op de challenge waar een team NU mee bezig is.
 *
 * Geen nieuw tijdmechanisme. Dit schrijft exact de rij die een Time Boost ook
 * schrijft: een vooraf geconsumeerde `time_boost`-rij in team_effects met
 * `{ added_seconds, challenge_id }`. Dat is met opzet, want die vorm heeft al
 * twee lezers die het allebei moeten weten:
 *
 *   de telefoon    de challengepagina luistert op team_effects INSERT en telt
 *                  added_seconds bij `timerBoostMs` op. De speler ziet de nieuwe
 *                  tijd meteen, zonder te herladen.
 *   de server      /api/auto-submit telt dezelfde rijen op bij de deadline
 *                  waarop hij een beurt afsluit. Zonder die kant zou de speler
 *                  meer tijd op zijn scherm zien dan hij werkelijk heeft.
 *
 * Een eigen kolom of een eigen effect-type zou één van die twee lezers missen —
 * precies de fout die de oorspronkelijke time_boost ooit cosmetisch maakte.
 *
 * ALLEEN BIJ EEN LOPENDE BEURT. Zonder open challenge_attempt is er niets om
 * tijd bij op te tellen: de rij zou blijven staan en pas gaan werken op het
 * moment dat het team die challenge later alsnog start. Dan geeft deze functie
 * liever een nette weigering terug.
 */
export async function grantExtraTime(
	db: AdminClient,
	input: {
		teamId: string;
		setId: string | null;
		challengeId: string;
		seconds: number;
		reason: string;
		actor: HostActor;
	}
): Promise<Uitkomst<{ seconds: number }>> {
	const reden = schoneReden(input.reason);
	if (!reden) return { ok: false, error: 'Een reden is verplicht.' };
	if (
		!Number.isInteger(input.seconds) ||
		input.seconds < EXTRA_TIJD_MIN_SECONDEN ||
		input.seconds > EXTRA_TIJD_MAX_SECONDEN
	) {
		return {
			ok: false,
			error: `Kies tussen ${EXTRA_TIJD_MIN_SECONDEN} en ${EXTRA_TIJD_MAX_SECONDEN} seconden.`
		};
	}

	const { data: attempt } = await db
		.from('challenge_attempts')
		.select('id')
		.eq('challenge_id', input.challengeId)
		.eq('team_id', input.teamId)
		.is('ended_at', null)
		.maybeSingle();
	if (!attempt) {
		return { ok: false, error: 'Dit team heeft geen lopende beurt op deze challenge.' };
	}

	const { error: effErr } = await db.from('team_effects').insert({
		team_id: input.teamId,
		set_id: input.setId,
		effect_type: 'time_boost',
		payload: {
			added_seconds: input.seconds,
			challenge_id: input.challengeId,
			// Zodat de telefoon kan zeggen WAAR de tijd vandaan komt: extra tijd die
			// uit het niets verschijnt is even verwarrend als tijd die verdwijnt.
			source: 'host'
		},
		consumed_at: new Date().toISOString(),
		consumed_challenge_id: input.challengeId
	} as never);
	if (effErr) return { ok: false, error: effErr.message };

	await db.from('activity_log').insert({
		event_type: 'host_time_granted',
		team_id: input.teamId,
		challenge_id: input.challengeId,
		payload: { ...logKop(reden, input.actor), seconds: input.seconds }
	} as never);

	return { ok: true, seconds: input.seconds };
}

// ─── 4. Challenge terugzetten voor één team ──────────────────────────────────

export type ResetUitkomst = {
	pointsDeducted: number;
	oldScore: number;
	newScore: number;
	submissionsDeleted: number;
	powerupsRevoked: number;
};

/**
 * Eén challenge terugzetten voor ÉÉN team, zodat ze hem opnieuw kunnen spelen.
 *
 * De gevoeligste van de vier, dus expliciet:
 *
 * ── WAT WEL WORDT TERUGGEDRAAID ─────────────────────────────────────────────
 *
 *   de inlevering         submissions van (challenge, team). review_requests
 *                         hangen er met ON DELETE CASCADE aan en gaan mee
 *                         (migratie 0009) — de reviewwachtrij houdt dus geen
 *                         verwijzing over naar een rij die er niet meer is.
 *   de beurt              challenge_attempts van (challenge, team). Zonder die
 *                         rij ziet de speler de challenge weer als speelbaar,
 *                         met de pre-game-poort ervoor, en start de timer pas
 *                         als hij opnieuw op start drukt.
 *   de punten             de teamscore min wat DEZE challenge opleverde. Dat is
 *                         breakdown.final als die er is, anders submissions.score
 *                         — dezelfde waarde die bij het inleveren is opgeteld.
 *   ongebruikte powerups  team_powerups van deze challenge op 'pending' of
 *                         'held' gaan naar 'lost'. Anders verdient het team bij
 *                         het opnieuw spelen een tweede set bovenop de eerste.
 *   de kroon              opnieuw bepaald, zonder steelbonus.
 *
 * ── WAT NIET WORDT TERUGGEDRAAID, en waarom ────────────────────────────────
 *
 *   gebruikte powerups    status 'active', 'used' of 'consumed'. Die zijn niet
 *                         ongedaan te maken: een Lucky Dice zit al in de score,
 *                         een Give a Shot is al gedronken, een Freeze heeft de
 *                         tijd van een ANDER team al gekost. Ze intrekken zou
 *                         betekenen dat deze ingreep aan andere teams komt, en
 *                         dat mag hij niet.
 *   punten uit powerups   Lucky Dice en Bonus Points schrijven rechtstreeks naar
 *                         teams.score, buiten deze challenge om. Ze zitten niet
 *                         in breakdown.final en worden dus niet afgetrokken —
 *                         terecht, want ze zijn niet door deze challenge
 *                         verdiend maar door de powerup.
 *   streak en drempel     teams.current_streak en last_threshold_crossed lopen
 *                         over MEERDERE challenges. Terugdraaien zou de uitkomst
 *                         van andere challenges van hetzelfde team veranderen,
 *                         en dat is precies wat deze ingreep belooft niet te
 *                         doen.
 *   andere teams          geen enkele query hier raakt een ander team_id.
 *   andere challenges     alles is afgebakend op deze challenge_id.
 *
 * ── WANNEER HIJ WEIGERT ─────────────────────────────────────────────────────
 *
 * Een battle die al beslecht is. De ranglijst van een battle is per definitie
 * een uitspraak over ALLE teams, en één team eruit trekken zou de andere vijf
 * een uitslag laten houden die nergens meer op slaat. Dat is de enige situatie
 * waarin de belofte "raakt geen ander team" niet waar te maken is, dus dan
 * gebeurt er niets.
 */
export async function resetTeamChallenge(
	db: AdminClient,
	input: {
		teamId: string;
		setId: string | null;
		challengeId: string;
		reason: string;
		actor: HostActor;
	}
): Promise<Uitkomst<ResetUitkomst>> {
	const reden = schoneReden(input.reason);
	if (!reden) return { ok: false, error: 'Een reden is verplicht.' };

	if (input.setId) {
		const { data: sc } = await db
			.from('set_challenges')
			.select('battle_resolved_at')
			.eq('set_id', input.setId)
			.eq('challenge_id', input.challengeId)
			.maybeSingle();
		if ((sc as { battle_resolved_at?: string | null } | null)?.battle_resolved_at) {
			return {
				ok: false,
				error:
					'Deze battle is al beslecht. De ranglijst geldt voor alle teams, dus één team terugzetten kan niet zonder de rest te raken.'
			};
		}
	}

	const { data: subs } = await db
		.from('submissions')
		.select('id, score, answers')
		.eq('challenge_id', input.challengeId)
		.eq('team_id', input.teamId);

	// breakdown.final vóór submissions.score: dat is de waarde die bij het
	// inleveren daadwerkelijk bij de teamscore is opgeteld (na multipliers,
	// streak, speed en powerups). `score` is dezelfde waarde voor elke rij die er
	// een breakdown bij heeft; de terugval is er voor oude rijen van vóór 0036.
	let pointsDeducted = 0;
	for (const s of subs ?? []) {
		const eerste = Array.isArray(s.answers)
			? (s.answers[0] as { breakdown?: { final?: number } })
			: null;
		const final = eerste?.breakdown?.final;
		pointsDeducted += typeof final === 'number' ? final : (s.score ?? 0);
	}

	const { data: team } = await db
		.from('teams')
		.select('score')
		.eq('id', input.teamId)
		.maybeSingle();
	if (!team) return { ok: false, error: 'Team niet gevonden.' };
	const oldScore = team.score ?? 0;
	const newScore = klem(oldScore - pointsDeducted);

	// Powerups van DEZE challenge die het team nog niet heeft ingezet. 'pending'
	// (nooit een keuze over gemaakt) en 'held' (bewaard maar ongebruikt) zijn de
	// twee standen waarin intrekken nog niets ongedaan maakt.
	const { data: revoked } = await db
		.from('team_powerups')
		.update({ status: 'lost' } as never)
		.eq('team_id', input.teamId)
		.eq('granted_from_challenge_id', input.challengeId)
		.in('status', ['pending', 'held'])
		.select('id');

	await db
		.from('submissions')
		.delete()
		.eq('challenge_id', input.challengeId)
		.eq('team_id', input.teamId);
	await db
		.from('challenge_attempts')
		.delete()
		.eq('challenge_id', input.challengeId)
		.eq('team_id', input.teamId);

	const { error: scoreErr } = await db
		.from('teams')
		.update({ score: newScore })
		.eq('id', input.teamId);
	if (scoreErr) return { ok: false, error: scoreErr.message };

	await db.from('activity_log').insert({
		event_type: 'attempt_reset',
		team_id: input.teamId,
		challenge_id: input.challengeId,
		payload: {
			...logKop(reden, input.actor),
			score_deducted: pointsDeducted,
			old_score: oldScore,
			new_score: newScore,
			submissions_deleted: (subs ?? []).length,
			powerups_revoked: (revoked ?? []).length
		}
	} as never);

	if (input.setId) await recomputeCrownHolder(db, input.setId);

	return {
		ok: true,
		pointsDeducted,
		oldScore,
		newScore,
		submissionsDeleted: (subs ?? []).length,
		powerupsRevoked: (revoked ?? []).length
	};
}
