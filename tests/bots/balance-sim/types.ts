// Gedeelde vormen van de balans-simulator. Geen server-imports: dit is data.

import type { TabInput } from '../../../src/lib/server/scoring';
import type { PowerupType } from '../../../src/lib/server/powerups';
import type { AnswerField, InputMode } from '../../../src/lib/types';

export type LoadedChallenge = {
	id: string;
	title: string;
	variant: string;
	position: number;
	points_config: Record<string, unknown>;
	difficulty_rating: number;
	speed_threshold_seconds: number | null;
	timer_seconds: number | null;
	challenge_multiplier: number;
	battle: { enabled: boolean; max_points: number };
	// Per tab de bronnen/clips zoals de submit-pipeline ze ziet, met een LEEG
	// concept — de engine vult playerDraft per team in.
	tabs: TabInput[];
	fields: AnswerField[];
	fieldModes: Record<string, InputMode>;
	fieldPoints: Record<string, number>;
	bonusFields: Set<string>;
	artistBonus: Record<string, number>;
	// Bonus-uitgesloten max (de noemer van het verdien-%), uit scoreTab met leeg concept.
	thresholdMax: number;
	maxTotal: number;
};

export type LoadedSet = {
	id: string;
	name: string;
	teamCount: number;
	hardGaanWindowMinutes: number;
	powerupsEnabled: boolean;
	rawPowerupConfig: unknown;
	challenges: LoadedChallenge[];
	powerupTypes: PowerupType[];
	streakThresholdsByVariant: Record<string, Array<{ streak: number; bonus: number }>>;
	fixesApplied: string[];
};

export type TeamSpec = { name: string; level: number };

export type Rng = () => number;

/** Wat een powerup uiteindelijk aan punten opleverde, per bron. */
export type Ledger = {
	base: number; // verplichte veldpunten (threshold-deel), vóór multipliers
	bonusFields: number; // bonusvelden + bonus-artiesten
	comebackDelta: number; // wat ×1,5 comeback erbij deed
	powerupMultDelta: number; // hard_gaan / single_event_mult / double_down
	insuranceDelta: number;
	revealPoints: number; // punten uit velden die door onthullers goed werden
	directPoints: number; // bonus_points, lucky_dice
	resurrectionDelta: number;
	streak: number;
	speed: number;
	battle: number;
	crown: number;
	attackLoss: number; // geschat puntverlies door ontvangen aanvallen
	comebackFired: number;
	final: number;
};

export type EarnedRecord = {
	challengeIndex: number;
	typeId: string;
	channel: 'ladder' | 'inverse' | 'spin';
	scorePct: number;
};

export type TeamOutcome = {
	name: string;
	level: number;
	ledger: Ledger;
	earned: EarnedRecord[];
	perChallengePct: number[];
	perChallengeFinal: number[];
};

export type GameOutcome = {
	teams: TeamOutcome[];
	battleAwards: number[][]; // [challengeIndex][teamIndex]
};
