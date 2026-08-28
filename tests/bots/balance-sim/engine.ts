// De spelmotor van de balans-simulator. Speelt één set door met N teams van
// een gegeven niveau, in dezelfde volgorde en met dezelfde rekenregels als de
// echte submit-pipeline (src/lib/server/submit.ts):
//
//   concept → scoreSubmission (echte scorer, echte computeBreakdown)
//           → teamscore + streak → kroon → planAwards (echte ladder)
//           → materialiseren (immediate vuurt, holdable naar voorraad)
//   na de challenge: battle-ladder (echte deriveLadder + computeBattleRanking)
//   na de set: resurrection-retries, kroon-uitbetaling
//
// Wat WEL gemodelleerd is (en niet uit de echte code komt): het gedrag van de
// bot — wanneer hij een powerup inzet en op wie — en het effect van
// tijd-aanvallen op de nauwkeurigheid. Die aannames staan in team-model.ts en
// in `policy` hieronder, zodat ze in één oogopslag te vinden en te betwisten zijn.
//
// Schrijft NIETS: geen DB, geen bestanden.

import { scoreSubmission, type BonusParams } from '../../../src/lib/server/scoring';
import {
	parseConfig,
	planAwards,
	pickSpinType,
	computePositionPercentile,
	rollDice,
	rollSingleEventMult,
	resolveDiceRange,
	type PowerupType
} from '../../../src/lib/server/powerups';
import type { PowerupConfigV2 } from '../../../src/lib/types';
import { computeBattleRanking, deriveLadder } from '../../../src/lib/battle-ranking';
import { resurrectionDelta, X_RAY_DEFAULT_BUDGET } from '../../../src/lib/powerups-meta';
import {
	buildDraft,
	cellsOf,
	cellKey,
	elapsedSecondsFor,
	ATTACK_PENALTY_PCT,
	type DraftPlan
} from './team-model';
import { shuffled } from './rng';
import type {
	EarnedRecord,
	GameOutcome,
	Ledger,
	LoadedSet,
	Rng,
	TeamSpec,
	TeamOutcome
} from './types';

export type EngineOptions = {
	teams: TeamSpec[];
	rawPowerupConfig: unknown; // de variant-config (ruw, zoals in game_sets.powerup_config)
	powerupsEnabled: boolean;
	streakThresholds?: Array<{ streak: number; bonus: number }> | null; // null = uit de variant_defaults (nu leeg)
	speedThresholdSeconds?: number | null; // null = uit de challenge (nu NULL)
	xrayBudget?: number;
};

type Pending = {
	hardGaanUntil: number; // challenge-index t/m waar ×1,5 geldt (-1 = niet)
	singleMult: number | null;
	bonusPts: number;
	doubleDownPct: number | null;
	insurance: boolean;
	freeAnswers: number;
	xrayCells: number;
	freeTab: boolean;
	lifeline: boolean;
	eye: boolean;
	timeBoost: boolean;
	shield: boolean;
	attacks: string[]; // type-ids om aan het begin van de volgende challenge af te vuren
	resurrection: boolean;
	penaltyPct: number; // ontvangen aanvallen, voor de komende challenge
};

type TeamState = {
	idx: number;
	spec: TeamSpec;
	score: number;
	streak: number;
	fieldsCorrect: number;
	fieldsTotal: number;
	pending: Pending;
	ledger: Ledger;
	earned: EarnedRecord[];
	perChallengePct: number[];
	perChallengeFinal: number[];
	perChallengeOldFinal: number[];
};

const emptyLedger = (): Ledger => ({
	base: 0,
	bonusFields: 0,
	comebackDelta: 0,
	powerupMultDelta: 0,
	insuranceDelta: 0,
	revealPoints: 0,
	directPoints: 0,
	resurrectionDelta: 0,
	streak: 0,
	speed: 0,
	battle: 0,
	crown: 0,
	attackLoss: 0,
	comebackFired: 0,
	final: 0
});

const emptyPending = (): Pending => ({
	hardGaanUntil: -1,
	singleMult: null,
	bonusPts: 0,
	doubleDownPct: null,
	insurance: false,
	freeAnswers: 0,
	xrayCells: 0,
	freeTab: false,
	lifeline: false,
	eye: false,
	timeBoost: false,
	shield: false,
	attacks: [],
	resurrection: false,
	penaltyPct: 0
});

// ── Bot-beleid ───────────────────────────────────────────────────────────────
// Eén plek voor "wat doet een team met wat het krijgt". Bewust simpel en
// gretig: alles wat op de volgende challenge kan werken wordt daar ingezet.
const policy = {
	/** Insurance is alleen nuttig als je onder 50 % dreigt te komen. */
	useInsurance: (level: number) => level < 55,
	/** Double Down: voorspel iets onder je eigen niveau. */
	doubleDownPrediction: (level: number) => Math.max(0, Math.round(level - 15)),
	/** Aanvallen gaan naar de leider (niet jezelf). */
	attackTarget: (teams: TeamState[], self: TeamState) =>
		teams.filter((t) => t !== self).sort((a, b) => b.score - a.score)[0] ?? null
};

export function runGame(set: LoadedSet, opts: EngineOptions, rng: Rng): GameOutcome {
	const cfg: PowerupConfigV2 = parseConfig(opts.rawPowerupConfig);
	const types: PowerupType[] = set.powerupTypes;
	const typeById = new Map(types.map((t) => [t.id, t]));
	const xrayBudget = opts.xrayBudget ?? X_RAY_DEFAULT_BUDGET;

	const teams: TeamState[] = opts.teams.map((spec, idx) => ({
		idx,
		spec,
		score: 0,
		streak: 0,
		fieldsCorrect: 0,
		fieldsTotal: 0,
		pending: emptyPending(),
		ledger: emptyLedger(),
		earned: [],
		perChallengePct: [],
		perChallengeFinal: [],
		perChallengeOldFinal: []
	}));
	const crown: { holder: TeamState | null } = { holder: null };
	const battleAwards: number[][] = [];

	const standings = () => teams.map((t) => ({ id: String(t.idx), score: t.score }));

	const transferCrown = (team: TeamState) => {
		if (crown.holder === team) return;
		if (crown.holder === null ? team.score > 0 : team.score > crown.holder.score) {
			team.score += 1;
			team.ledger.crown += 1;
			crown.holder = team;
		}
	};

	/** materializeAward: immediate vuurt nu, holdable naar de voorraad. */
	const materialize = (
		team: TeamState,
		type: PowerupType,
		ci: number,
		channel: EarnedRecord['channel'],
		scorePct: number
	) => {
		team.earned.push({ challengeIndex: ci, typeId: type.id, channel, scorePct });
		const p = team.pending;
		switch (type.id) {
			case 'bonus_points':
				p.bonusPts += 5;
				return;
			case 'hard_gaan':
				p.hardGaanUntil = ci + 1;
				return; // 15-min-venster ≈ de volgende challenge
			case 'single_event_mult':
				p.singleMult = rollSingleEventMult(rng);
				return;
			case 'lucky_dice': {
				const { min, max } = resolveDiceRange(cfg);
				const roll = rollDice(min, max, rng);
				team.score += roll;
				team.ledger.directPoints += roll;
				transferCrown(team);
				return;
			}
			case 'power_spin': {
				const pick = pickSpinType(cfg, types, rng);
				if (pick.type) materialize(team, pick.type, ci, 'spin', scorePct);
				return;
			}
			case 'penalty_shot':
			case 'give_a_shot':
				return; // sociaal
			case 'free_answer':
				p.freeAnswers += 1;
				return;
			case 'x_ray':
				p.xrayCells += xrayBudget;
				return;
			case 'free_tab':
				p.freeTab = true;
				return;
			case 'lifeline':
				p.lifeline = true;
				return;
			case 'all_seeing_eye':
				p.eye = true;
				return;
			case 'insurance':
				if (policy.useInsurance(team.spec.level)) p.insurance = true;
				return;
			case 'time_boost':
				p.timeBoost = true;
				return;
			case 'shield':
				p.shield = true;
				return;
			case 'double_down':
				p.doubleDownPct = policy.doubleDownPrediction(team.spec.level);
				return;
			case 'freeze':
			case 'time_drain':
			case 'tap_to_break':
				p.attacks.push(type.id);
				return;
			case 'resurrection':
				p.resurrection = true;
				return;
		}
	};

	for (let ci = 0; ci < set.challenges.length; ci++) {
		const ch = set.challenges[ci];
		const cells = cellsOf(ch);
		const finishedLevels: number[] = [];
		const finalThisChallenge = new Map<TeamState, number>();

		// De comeback-basis: de stand zoals die was VOORDAT iemand deze challenge
		// speelde — precies wat standingsAtRoundStart in de echte pijplijn doet,
		// hier simpelweg vastgelegd aan het begin van de ronde omdat de simulator
		// weet wanneer een ronde begint. Het alternatief (live Math.max over
		// teams.score) modelleerde de bug: wie als eerste inleverde tilde de leider
		// op voor alle anderen, en kreeg zelf nooit de bonus.
		const roundStartLeader = Math.max(0, ...teams.map((t) => t.score));
		const roundStartScore = new Map(teams.map((t) => [t, t.score]));

		// ── Aanvallen aan het begin van de challenge, op de leider ────────────
		for (const t of teams) {
			for (const atk of t.pending.attacks) {
				const target = policy.attackTarget(teams, t);
				if (!target) continue;
				if (target.pending.shield) {
					target.pending.shield = false;
					continue;
				}
				target.pending.penaltyPct += ATTACK_PENALTY_PCT[atk] ?? 0;
			}
			t.pending.attacks = [];
		}

		for (const team of shuffled(teams, rng)) {
			const p = team.pending;
			const level = team.spec.level - p.penaltyPct + (p.timeBoost ? 2 : 0);

			// Onthullingen: willekeurige cellen (het team weet niet welke fout zijn).
			const reveals = new Set<string>();
			const pool = shuffled(
				cells.filter((c) => c.field !== 'grouping'),
				rng
			);
			for (let k = 0; k < p.freeAnswers + p.xrayCells && k < pool.length; k++)
				reveals.add(cellKey(pool[k]));
			const wholeTracks = new Set<string>();
			if (p.freeTab) {
				const c = pool[0];
				if (c) wholeTracks.add(`${c.tabIndex}:${c.slotIndex}`);
			}
			const plan: DraftPlan = {
				level,
				reveals,
				revealWholeTracks: wholeTracks,
				lifeline: p.lifeline,
				eyeBestLevel: p.eye && finishedLevels.length ? Math.max(...finishedLevels) : null
			};
			const { tabs, helpedCells } = buildDraft(ch, plan, rng);

			const elapsed = elapsedSecondsFor(level, ch.timer_seconds, rng);
			const extraMultipliers: number[] = [];
			if (p.hardGaanUntil >= ci && p.hardGaanUntil !== -1) extraMultipliers.push(1.5);
			if (p.singleMult !== null) extraMultipliers.push(p.singleMult);
			const bonus: BonusParams = {
				difficulty_rating: ch.difficulty_rating,
				challenge_multiplier: ch.challenge_multiplier,
				// De comeback-basis, allebei op de stand bij aanvang van de ronde.
				team_score: roundStartScore.get(team) ?? team.score,
				leader_score: roundStartLeader,
				current_streak: team.streak,
				streak_thresholds: opts.streakThresholds ?? set.streakThresholdsByVariant[ch.variant] ?? [],
				elapsed_seconds: elapsed,
				speed_threshold_seconds: opts.speedThresholdSeconds ?? ch.speed_threshold_seconds,
				extraMultipliers,
				insuranceActive: p.insurance,
				bonusPoints: p.bonusPts,
				doubleDownPct: p.doubleDownPct
			};
			const { result } = scoreSubmission(
				tabs,
				ch.fields,
				ch.fieldModes,
				ch.fieldPoints,
				bonus,
				ch.bonusFields,
				ch.artistBonus
			);
			const bd = result.breakdown!;
			const final = bd.final;

			// ── Grootboek ────────────────────────────────────────────────────────
			const L = team.ledger;
			const baseUsed = bd.base; // ná insurance-vloer
			L.base += result.thresholdTotal ?? 0;
			L.bonusFields += result.total - (result.thresholdTotal ?? 0);
			L.insuranceDelta += baseUsed - result.total;
			const comebackPart = Math.round(baseUsed * (bd.comeback_multiplier - 1));
			const multiplied = final - bd.streak_bonus - bd.speed_bonus - (bd.bonus_powerup ?? 0);
			L.comebackDelta += comebackPart;
			if (bd.comeback_multiplier > 1) L.comebackFired += 1;
			L.powerupMultDelta += multiplied - baseUsed - comebackPart;
			L.revealPoints += helpedCells.reduce((s, c) => s + c.maxPoints, 0);
			L.directPoints += bd.bonus_powerup ?? 0;
			L.streak += bd.streak_bonus;
			L.speed += bd.speed_bonus;
			L.attackLoss += Math.round((p.penaltyPct / 100) * ch.thresholdMax);

			team.score += final;
			team.streak = result.total > 0 ? team.streak + 1 : 0;
			team.fieldsCorrect += result.fieldsCorrect ?? 0;
			team.fieldsTotal += result.fieldsTotal ?? 0;
			const pct = ch.thresholdMax > 0 ? ((result.thresholdTotal ?? 0) / ch.thresholdMax) * 100 : 0;
			team.perChallengePct.push(pct);
			team.perChallengeFinal.push(final);
			team.perChallengeOldFinal.push(final);
			finalThisChallenge.set(team, final);
			finishedLevels.push(team.spec.level);
			transferCrown(team);

			// Verbruikt: alles wat op deze challenge werkte.
			p.singleMult = null;
			p.bonusPts = 0;
			p.doubleDownPct = null;
			p.insurance = false;
			p.freeAnswers = 0;
			p.xrayCells = 0;
			p.freeTab = false;
			p.lifeline = false;
			p.eye = false;
			p.timeBoost = false;
			p.penaltyPct = 0;

			// ── Verdienen (echte planner) ────────────────────────────────────────
			if (opts.powerupsEnabled && set.powerupsEnabled) {
				const plan = planAwards(
					cfg,
					types,
					{
						submissionPct: pct,
						cumulativePct: 0,
						thresholdMode: cfg.threshold_mode,
						bandMode: cfg.band_mode,
						lastThresholdCrossed: 0,
						positionPercentile: computePositionPercentile(standings(), String(team.idx)),
						fieldsCorrectFraction:
							team.fieldsTotal > 0 ? team.fieldsCorrect / team.fieldsTotal : undefined
					},
					rng
				);
				for (const a of plan.awards) {
					const t = typeById.get(a.typeId);
					if (t) materialize(team, t, ci, a.channel, pct);
				}
			}
		}

		// ── Battle-ladder ────────────────────────────────────────────────────
		const awards = teams.map(() => 0);
		if (ch.battle.enabled) {
			const ladder = deriveLadder(ch.battle.max_points, teams.length);
			const ranking = computeBattleRanking(
				teams.map((t) => ({ teamId: String(t.idx), score: finalThisChallenge.get(t) ?? 0 })),
				ladder
			);
			for (const r of ranking) {
				const t = teams[Number(r.team_id)];
				t.score += r.awarded;
				t.ledger.battle += r.awarded;
				awards[t.idx] = r.awarded;
			}
		}
		battleAwards.push(awards);
	}

	// ── Resurrection: de slechtste challenge overspelen (score_mode replace) ─
	for (const team of teams) {
		if (!team.pending.resurrection) continue;
		let worst = 0;
		for (let i = 1; i < team.perChallengePct.length; i++)
			if (team.perChallengePct[i] < team.perChallengePct[worst]) worst = i;
		const ch = set.challenges[worst];
		const { tabs } = buildDraft(
			ch,
			{
				level: team.spec.level,
				reveals: new Set(),
				revealWholeTracks: new Set(),
				lifeline: false,
				eyeBestLevel: null
			},
			rng
		);
		const { result } = scoreSubmission(
			tabs,
			ch.fields,
			ch.fieldModes,
			ch.fieldPoints,
			{
				difficulty_rating: ch.difficulty_rating,
				challenge_multiplier: ch.challenge_multiplier,
				// Zoals standingsAtRoundStart het bij een retry doet: de HUIDIGE
				// stand, met van elk team de score van de challenge die overgespeeld
				// wordt eruit gehaald.
				team_score: Math.max(0, team.score - (team.perChallengeOldFinal[worst] ?? 0)),
				leader_score: Math.max(
					0,
					...teams.map((t) => Math.max(0, t.score - (t.perChallengeOldFinal[worst] ?? 0)))
				),
				current_streak: 0,
				streak_thresholds: [],
				elapsed_seconds: null,
				speed_threshold_seconds: null
			},
			ch.bonusFields,
			ch.artistBonus
		);
		const delta = resurrectionDelta(
			team.perChallengeOldFinal[worst],
			result.breakdown!.final,
			'replace'
		);
		team.score += delta;
		team.ledger.resurrectionDelta += delta;
		transferCrown(team);
	}

	if (crown.holder) {
		crown.holder.score += 2;
		crown.holder.ledger.crown += 2;
	}

	for (const t of teams) t.ledger.final = t.score;
	const out: TeamOutcome[] = teams.map((t) => ({
		name: t.spec.name,
		level: t.spec.level,
		ledger: t.ledger,
		earned: t.earned,
		perChallengePct: t.perChallengePct,
		perChallengeFinal: t.perChallengeFinal
	}));
	return { teams: out, battleAwards };
}
