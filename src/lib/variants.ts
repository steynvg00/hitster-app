import { Music, Flag, Tag, Blend, Puzzle, Sliders, HelpCircle } from 'lucide-svelte';
import type { ChallengeType } from '$lib/types/index.js';
import { CHALLENGE_LOGOS } from '$lib/mixup-assets';

export const CHALLENGE_TYPES = [
	'standard',
	'anthem',
	'label',
	'mashup',
	'fragments',
	'effects'
] as const satisfies readonly ChallengeType[];

// Keep VARIANTS as an alias for callers that haven't migrated yet
export const VARIANTS = CHALLENGE_TYPES;

export type { ChallengeType };

/**
 * Het icoon per challenge-type, als DIRECTE componentverwijzing.
 *
 * Dit was een `Record<ChallengeType, string>` met een dynamische lookup in een
 * `import * as LucideIcons`-namespace. Rollup kan een namespace waar met een
 * variabele in geïndexeerd wordt niet tree-shaken, dus belandde de HELE
 * lucide-bibliotheek in de bundel: 857.636 bytes met 1.686 iconen voor de 21 die
 * deze app gebruikt. Die chunk hing aan de root-layout, dus élke pagina — ook de
 * eerste die een speler ziet — laadde en parseerde hem.
 *
 * Named imports met een letterlijke map zijn statisch te volgen: alleen deze
 * zeven iconen overleven de build.
 */
const TYPE_ICON: Record<ChallengeType, typeof Music> = {
	standard: Music,
	anthem: Flag,
	label: Tag,
	mashup: Blend,
	fragments: Puzzle,
	effects: Sliders
};

const TYPE_COLOR: Record<ChallengeType, string> = {
	standard: 'bg-mixup-cyan/10 text-mixup-cyan',
	anthem: 'bg-mixup-magenta/10 text-mixup-magenta',
	label: 'bg-mixup-yellow/10 text-mixup-yellow',
	mashup: 'bg-mixup-violet/10 text-mixup-violet',
	fragments: 'bg-mixup-orange/10 text-mixup-orange',
	effects: 'bg-green-900/20 text-green-400'
};

const TYPE_DESCRIPTION: Record<ChallengeType, string> = {
	standard: 'Artist · Title · Year',
	anthem: 'Festival · Artist · Title · Year',
	label: 'Label · Artist · Title · Year',
	mashup: 'Pick a mashup; players identify source tracks',
	fragments: 'Numbered clips; players name each source track',
	effects: 'Audio FX chain per tab — artist · title · year'
};

export function getTypeIcon(type: string): typeof Music {
	return TYPE_ICON[type as ChallengeType] ?? HelpCircle;
}

export function getTypeColor(type: string): string {
	return TYPE_COLOR[type as ChallengeType] ?? 'bg-zinc-700 text-zinc-400';
}

export function getTypeDescription(type: string): string {
	return TYPE_DESCRIPTION[type as ChallengeType] ?? '';
}

/**
 * Challenge-logo per type, met de hoogte uit de designspec. Elk van de zes
 * challenge-types heeft precies een logo-afbeelding; de hoogtes (31/39/23/28/
 * 44/24px) staan vast en de logo's zijn links uitgelijnd op max-width 150px.
 * Bron: design_handoff_mixup_redesign/README.md, scherm 5 (team-hub console).
 */
const TYPE_LOGO: Record<ChallengeType, { src: string; height: number }> = {
	standard: CHALLENGE_LOGOS.hitster,
	anthem: CHALLENGE_LOGOS.anthems,
	label: CHALLENGE_LOGOS.icons,
	effects: CHALLENGE_LOGOS.effects,
	fragments: CHALLENGE_LOGOS.fragments,
	mashup: CHALLENGE_LOGOS.mashups
};

/**
 * Logo's die per CHALLENGE gekozen worden in plaats van per type.
 *
 * Hitster en Icons zijn allebei variant `standard`, dus op het type alleen
 * kreeg Icons het Hitster-logo. Er is (nog) geen icon_asset-kolom, dus de
 * keuze hangt aan het enige stabiele kenmerk dat de challenge zelf al heeft:
 * zijn titel. De sleutelwoorden hieronder komen 1-op-1 overeen met de namen
 * in CHALLENGE_LOGOS, zodat een challenge die "Icons" heet het Icons-logo
 * krijgt en een die "Hitster" heet het Hitster-logo — ongeacht variant.
 *
 * Volgorde telt: de eerste treffer wint. Zet specifiekere sleutelwoorden
 * daarom vóór algemenere.
 */
const TITLE_LOGO: ReadonlyArray<[RegExp, { src: string; height: number }]> = [
	[/\bicons?\b/i, CHALLENGE_LOGOS.icons],
	[/\bhitster\b/i, CHALLENGE_LOGOS.hitster],
	[/\banthems?\b/i, CHALLENGE_LOGOS.anthems],
	[/\bfragments?\b/i, CHALLENGE_LOGOS.fragments],
	[/\bmash-?ups?\b/i, CHALLENGE_LOGOS.mashups],
	[/\beffects?\b/i, CHALLENGE_LOGOS.effects]
];

/**
 * Het logo van EEN challenge. Geef de titel mee waar je die hebt: dan wint
 * een titeltreffer van de type-fallback. Zonder titel is het gedrag exact
 * als voorheen (puur op type).
 */
export function getChallengeLogo(
	type: string,
	title?: string | null
): { src: string; height: number } | null {
	if (title) {
		for (const [pattern, logo] of TITLE_LOGO) {
			if (pattern.test(title)) return logo;
		}
	}
	return TYPE_LOGO[type as ChallengeType] ?? null;
}

export function getTypeLogo(type: string): { src: string; height: number } | null {
	return TYPE_LOGO[type as ChallengeType] ?? null;
}

// Legacy aliases — callers import these without breaking
export const getVariantIcon = getTypeIcon;
export const getVariantColor = getTypeColor;
