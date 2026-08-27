/**
 * Nederlandse speler-copy voor de powerup-laag (redesign fase 4).
 *
 * PUUR PRESENTATIE. Dit bestand bepaalt NIETS over gedrag: geen
 * activatiepad, geen doelselectie, geen earn- of scoringregel. Het vertaalt
 * alleen wat er op het scherm staat.
 *
 * Waarom hier en niet in de database: `powerup_types.name` en
 * `.description` zijn Engels en worden door de admin-console gelezen. Ze
 * aanpassen zou een DB-wijziging zijn (buiten de opdracht) én de host-UI
 * meeveranderen. Deze module legt er een speler-laag overheen; ontbreekt een
 * id, dan valt alles terug op de kolomwaarde uit de database.
 *
 * Bewust GESCHEIDEN van $lib/powerups-meta.ts: daar staat de gedeelde
 * spel-logica (multipliers, maskeerregel, wire-types) die server én client
 * draaien. Copy hoort daar niet tussen.
 */

/** Categorie-label onder de naam in de bottom-sheet (design: AANVAL / HULP / VERDEDIGING). */
export const CATEGORY_LABEL_NL: Record<string, string> = {
	defensive: 'VERDEDIGING',
	self: 'BOOST',
	information: 'HULP',
	offensive: 'AANVAL',
	social: 'SOCIAAL',
	punishment: 'STRAF',
	wildcard: 'WILDCARD'
};

export function categoryLabel(category: string | null | undefined): string {
	return CATEGORY_LABEL_NL[category ?? ''] ?? 'POWERUP';
}

type PowerupCopy = {
	/** Korte naam, hoofdletters — chip + sheet-titel + modal-titel. */
	name: string;
	/** Wat de powerup doet, in twee zinnen hooguit. */
	desc: string;
	/** Amberkleurige waarschuwing; weglaten als er niets te waarschuwen valt. */
	warn?: string;
};

/**
 * Per powerup_types.id. De teksten zijn de Nederlandse tegenhanger van de
 * EFFECT_COPY-strings die de activatiemodal al toonde — dezelfde beloftes,
 * dezelfde getallen.
 */
export const POWERUP_COPY_NL: Record<string, PowerupCopy> = {
	shield: {
		name: 'SCHILD',
		desc: 'Blokkeert automatisch de eerstvolgende aanval op jullie team. Je merkt er pas iets van als het gebeurt.',
		warn: 'Eén blokkade, daarna is het schild op'
	},
	time_boost: {
		name: 'TIME BOOST',
		desc: '+30 seconden op de klok van de challenge waar jullie nu in zitten.',
		warn: 'Werkt alleen tijdens een challenge met een timer'
	},
	insurance: {
		name: 'VERZEKERING',
		desc: 'Scoren jullie onder 50% van het maximum, dan wordt je basisscore opgetrokken naar 50%.',
		warn: 'Wordt verbruikt zodra jullie deze challenge inleveren'
	},
	bonus_points: {
		name: 'BONUSPUNTEN',
		desc: '+5 punten bovenop het totaal van jullie volgende inzending.'
	},
	hard_gaan: {
		name: 'HARD GAAN',
		desc: '1,5x op álle inzendingen in de komende 15 minuten.'
	},
	single_event_mult: {
		name: 'MULTIPLIER',
		desc: 'Willekeurige multiplier (x1,2 / x1,4 / x1,6) over de eindscore van jullie volgende challenge.'
	},
	free_answer: {
		name: 'GRATIS ANTWOORD',
		desc: 'Onthult één veld naar keuze. Het antwoord wordt écht ingevuld — gratis punten voor dat veld.',
		warn: 'Werkt alleen tijdens een challenge die jullie gestart zijn'
	},
	freeze: {
		name: 'FREEZE',
		desc: 'Bevries het scherm van een ander team. Hun formulier is die tijd onaanraakbaar.',
		warn: 'Werkt alleen op teams die nú in een challenge zitten'
	},
	time_drain: {
		name: 'TIME DRAIN',
		desc: 'Trekt ongeveer 15 seconden van de klok van een ander team.',
		warn: 'Werkt alleen op teams die nú in een challenge zitten'
	},
	tap_to_break: {
		name: 'VERGRENDELEN',
		desc: 'Een ander team moet een slot kapot tikken voordat het kan inleveren.',
		warn: 'Werkt alleen op teams die nú in een challenge zitten'
	},
	give_a_shot: {
		name: 'GEEF EEN SHOT',
		desc: 'Kies een team — zij nemen een echte shot. Geen effect op de score.',
		warn: 'Wordt geblokkeerd als zij een schild ophebben'
	},
	double_down: {
		name: 'DOUBLE DOWN',
		desc: 'Voorspel hoeveel procent van de volgende challenge jullie scoren. Haal je het, dan gaan je punten met dat percentage omhoog — mis je, dan even hard omlaag.',
		warn: 'Alleen vóór een challenge te zetten; geldt voor je volgende inzending'
	},
	lifeline: {
		name: 'LIFELINE',
		desc: 'Onthult een gemaskeerde hint — de eerste letter van elk woord — voor elk antwoord dat nog niet goed staat. Je typt ze zelf.',
		warn: 'Pas halverwege een challenge met een timer te gebruiken'
	},
	lucky_dice: {
		name: 'LUCKY DICE',
		desc: 'Gooi de dobbelsteen — wat je gooit gaat direct bij je score op.'
	},
	penalty_shot: {
		name: 'STRAFSHOT',
		desc: 'Te laag gescoord — strafshot. Naar binnen ermee.'
	},
	x_ray: {
		name: 'X-RAY',
		desc: 'Levert 5 onthullingen op. Geef ze één antwoord per keer uit, op elke tab, terwijl je speelt.',
		warn: 'Een onthulling kan alleen tijdens een gestarte challenge'
	},
	free_tab: {
		name: 'GRATIS TAB',
		desc: 'Kies één tab en één track daarop — elk veld van die track wordt onthuld en ingevuld, clipnummers inbegrepen.',
		warn: 'Werkt alleen tijdens een challenge die jullie gestart zijn'
	},
	power_spin: {
		name: 'POWER SPIN',
		desc: 'Draai aan het wiel en win een andere powerup.'
	},
	all_seeing_eye: {
		name: 'ALL-SEEING EYE',
		desc: 'Opent het Oog op elk team dat deze challenge al af heeft — je ziet hun antwoorden precies zoals ze ze typten. Je hoort NIET welke goed zijn.',
		warn: 'Er moet minstens één ander team klaar zijn, anders blijft het Oog in je bezit'
	},
	resurrection: {
		name: 'RESURRECTION',
		desc: 'Haalt één afgeronde challenge terug uit de dood. Je speelt hem opnieuw op een dérde van de oorspronkelijke klok; je score verschuift met het verschil.',
		warn: 'Eén challenge tegelijk, en één poging — na inleveren gaat hij weer op slot'
	}
};

/** Naam voor het scherm. Valt terug op de databasenaam in hoofdletters. */
export function powerupName(id: string, fallback?: string | null): string {
	return POWERUP_COPY_NL[id]?.name ?? (fallback ?? id).toUpperCase();
}

/** Beschrijving voor het scherm. Valt terug op de databasebeschrijving. */
export function powerupDesc(id: string, fallback?: string | null): string {
	return POWERUP_COPY_NL[id]?.desc ?? fallback ?? '';
}

/** Waarschuwing, of null als deze powerup er geen heeft. */
export function powerupWarn(id: string): string | null {
	return POWERUP_COPY_NL[id]?.warn ?? null;
}

/** Veldlabels, in de volgorde waarin het antwoordformulier ze toont. */
export const FIELD_LABEL_NL: Record<string, string> = {
	artist: 'ARTIEST',
	title: 'TITEL',
	year: 'JAAR',
	label: 'LABEL',
	festival: 'FESTIVAL',
	vocal_source: 'VOCAL',
	grouping: 'INDELING'
};

export function fieldLabel(field: string): string {
	return FIELD_LABEL_NL[field] ?? field.replace(/_/g, ' ').toUpperCase();
}

/**
 * Accentkleur van de activatiemodal. Puur vormgeving: het bepaalt de
 * randkleur, de glow en de kleur van de gekozen optie — verder niets.
 *
 * De designbron geeft per scherm een kleur: freeze cyaan (scherm 2), x-ray
 * geel en de trackkiezer violet (scherm 3), double down magenta (scherm 4),
 * het Oog violet (scherm 9). Deze tabel legt dat vast per id, met de
 * categorie als terugval voor een type dat nog geen eigen scherm heeft.
 */
const ACCENT_BY_ID: Record<string, string> = {
	freeze: '#00E5FF',
	time_drain: '#00E5FF',
	tap_to_break: '#00E5FF',
	give_a_shot: '#FF2DAA',
	double_down: '#FF2DAA',
	all_seeing_eye: '#7C4DFF',
	x_ray: '#FFE600',
	free_answer: '#FFE600',
	free_tab: '#FFE600',
	lifeline: '#FFE600',
	power_spin: '#FFE600',
	lucky_dice: '#2BD97A'
};

const ACCENT_BY_CATEGORY: Record<string, string> = {
	offensive: '#00E5FF',
	information: '#FFE600',
	defensive: '#7C4DFF',
	self: '#FFE600',
	social: '#FF2DAA',
	punishment: '#FF2DAA',
	wildcard: '#7C4DFF'
};

export function powerupAccent(id: string, category?: string | null): string {
	return ACCENT_BY_ID[id] ?? ACCENT_BY_CATEGORY[category ?? ''] ?? '#7C4DFF';
}

/**
 * Werkwoord op de afvuurknop van een gerichte powerup, in de vorm
 * "{verb} TEAM ROOD". Alleen de knoptekst — welk team geraakt wordt en of
 * dat mag, bepaalt de bestaande logica.
 */
const FIRE_VERB_NL: Record<string, string> = {
	freeze: 'BEVRIES',
	time_drain: 'TAP TIJD AF BIJ',
	tap_to_break: 'VERGRENDEL',
	give_a_shot: 'GEEF EEN SHOT AAN'
};

export function fireVerb(id: string): string {
	return FIRE_VERB_NL[id] ?? 'VUUR AF OP';
}
