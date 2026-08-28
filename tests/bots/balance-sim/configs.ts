// De configvarianten die de simulator naast elkaar zet. Elke variant is een
// FUNCTIE van de ruwe set-config (game_sets.powerup_config) naar een nieuwe
// ruwe config — via mergeConfigPatch, dezelfde helper die de console gebruikt —
// zodat wat hier staat één-op-één in de database geplakt kan worden.
//
// De a/b/c/d-indeling (INDELING_TYPES) is de kern van "punt 4":
//   a  hoge-score-exclusief   krachtig, geen onthullers        75–100 / 85–100
//   b  lage-score-exclusief   hulp, geen troostprijs           20–55
//   c  altijd verdienbaar     de middenmoot, incl. onthullers  20–100
//   d  het vangnet            weight_modifier op de hulp-types: ×3 als het
//      team achterligt (positie ≤ 0.35, relatief) OF slecht speelt (aandeel
//      volledig goede velden ≤ 0.45, absoluut — dus óók als iedereen slecht is)
//
// De laagste drempel gaat van 35 naar 20: zonder die verschuiving vuurt de
// ladder onder 35 % niet en bestaat categorie b niet.

import { mergeConfigPatch } from '../../../src/lib/server/powerups';
import type { PowerupTypeOverride, SafetyNetModifier } from '../../../src/lib/types';
import type { FieldOverride } from './load';

export type VariantDef = {
	key: string;
	label: string;
	powerupConfig: (raw: unknown) => unknown;
	fieldOverrides?: FieldOverride[];
};

export const VANGNET: SafetyNetModifier = {
	factor: 4,
	combine: 'or',
	conditions: [
		{ axis: 'position', lte: 0.35 },
		{ axis: 'performance', lte: 0.45 }
	]
};

export const VANGNET_KANS: SafetyNetModifier = { ...VANGNET, factor: 2 };

const A_HIGH = { min_score_pct: 75, max_score_pct: 100 };
const A_TOP = { min_score_pct: 85, max_score_pct: 100 };
const B_LOW = { min_score_pct: 20, max_score_pct: 55 };
const C_ALL = { min_score_pct: 20, max_score_pct: 100 };

export const INDELING_TYPES: Record<string, PowerupTypeOverride> = {
	// ── a. hoge-score-exclusief ─────────────────────────────────────────────
	hard_gaan: { enabled: true, ...A_HIGH },
	single_event_mult: { enabled: true, ...A_HIGH },
	double_down: { enabled: true, ...A_HIGH },
	freeze: { enabled: true, ...A_HIGH },
	time_drain: { enabled: true, ...A_HIGH },
	tap_to_break: { enabled: true, ...A_HIGH },
	power_spin: { enabled: true, ...A_TOP },
	resurrection: { enabled: true, ...A_TOP },
	// ── b. lage-score-exclusief ─────────────────────────────────────────────
	// Lifeline blijft op zijn eigen kanaal (inverse: per inlevering, kans 0,5, los van
	// de ladder) — dat is het type; alleen het BEREIK en het vangnet veranderen.
	// chance_modifier is het inverse-kanaal-equivalent van weight_modifier: ×2 → kans 1,0
	// zodra het team achterligt of slecht speelt.
	lifeline: { enabled: true, inverse: true, chance: 0.5, ...B_LOW, chance_modifier: VANGNET_KANS },
	insurance: { enabled: true, ...B_LOW, weight_modifier: VANGNET },
	time_boost: { enabled: true, ...B_LOW },
	shield: { enabled: true, ...B_LOW },
	// ── c. altijd verdienbaar ───────────────────────────────────────────────
	free_answer: { enabled: true, ...C_ALL, weight_modifier: VANGNET },
	x_ray: { enabled: true, ...C_ALL, weight_modifier: VANGNET },
	free_tab: { enabled: true, ...C_ALL, weight_modifier: VANGNET },
	bonus_points: { enabled: true, ...C_ALL, weight_modifier: VANGNET },
	lucky_dice: { enabled: true, ...C_ALL, weight_modifier: VANGNET },
	give_a_shot: { enabled: true, ...C_ALL },
	all_seeing_eye: { enabled: true, ...C_ALL }
	// penalty_shot: ongewijzigd (inverse ≤ 40 %, sociaal, geen scoreffect)
};

export const INDELING_THRESHOLDS = [20, 75, 100];

export const CATEGORIE: Record<string, 'a' | 'b' | 'c' | '–'> = {
	hard_gaan: 'a',
	single_event_mult: 'a',
	double_down: 'a',
	freeze: 'a',
	time_drain: 'a',
	tap_to_break: 'a',
	power_spin: 'a',
	resurrection: 'a',
	lifeline: 'b',
	insurance: 'b',
	time_boost: 'b',
	shield: 'b',
	free_answer: 'c',
	x_ray: 'c',
	free_tab: 'c',
	bonus_points: 'c',
	lucky_dice: 'c',
	give_a_shot: 'c',
	all_seeing_eye: 'c',
	penalty_shot: '–'
};

function indelingConfig(raw: unknown): unknown {
	return mergeConfigPatch(raw, {
		thresholds_percent: INDELING_THRESHOLDS,
		band_mode: 'all_bands',
		threshold_mode: 'per_challenge',
		types: INDELING_TYPES
	});
}

export const BONUS_LAAG: FieldOverride[] = [
	{ challengeTitleIncludes: 'Icons', field: 'year', max_points: 3 },
	{ challengeTitleIncludes: 'Fragments', field: 'year', max_points: 3 }
];

export const VARIANTS: VariantDef[] = [
	{ key: 'huidig', label: 'HUIDIG (config zoals in de database)', powerupConfig: (raw) => raw },
	{
		key: 'indeling',
		label: 'INDELING a/b/c/d (drempels 20/75/100)',
		powerupConfig: indelingConfig
	},
	{
		key: 'highest',
		label: 'INDELING + band_mode = highest_band',
		powerupConfig: (raw) => mergeConfigPatch(indelingConfig(raw), { band_mode: 'highest_band' })
	},
	{
		key: 'bonus3',
		label: 'INDELING + bonusjaar Icons/Fragments 10 → 3',
		powerupConfig: indelingConfig,
		fieldOverrides: BONUS_LAAG
	}
];

export function variantByKey(key: string): VariantDef {
	const v = VARIANTS.find((x) => x.key === key);
	if (!v)
		throw new Error(
			`Onbekende variant '${key}'. Kies uit: ${VARIANTS.map((x) => x.key).join(', ')}`
		);
	return v;
}
