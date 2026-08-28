// Aggregatie over N runs en een leesbaar Markdown-rapport.

import { CATEGORIE } from './configs';
import type { GameOutcome, Ledger, TeamSpec } from './types';

export type Aggregate = {
	label: string;
	runs: number;
	teams: Array<{
		name: string;
		level: number;
		ledger: Ledger; // gemiddelden
		finalNoPowerups: number; // gemiddelde eindstand in de baseline zonder powerups
		earnedPerGame: number;
		earnedByType: Record<string, number>; // gemiddeld per spel
		earnedByChallenge: number[]; // gemiddeld per spel, per challenge-index
		firstEarnAt: Record<string, number>; // gemiddelde challenge-index (1-based) waarop dit type voor het eerst viel
		pctPerChallenge: number[];
		pctPerChallengeNoPowerups: number[];
	}>;
	gap: number; // gemiddeld verschil eerste–laatste
	gapNoPowerups: number;
	battleTotal: number[];
};

const LEDGER_KEYS: Array<keyof Ledger> = [
	'base',
	'bonusFields',
	'comebackDelta',
	'powerupMultDelta',
	'insuranceDelta',
	'revealPoints',
	'directPoints',
	'resurrectionDelta',
	'streak',
	'speed',
	'battle',
	'crown',
	'attackLoss',
	'comebackFired',
	'final'
];

export function aggregate(
	label: string,
	specs: TeamSpec[],
	withPowerups: GameOutcome[],
	noPowerups: GameOutcome[],
	challengeCount: number
): Aggregate {
	const runs = withPowerups.length;
	const teams = specs.map((spec, ti) => {
		const ledger = {} as Ledger;
		for (const k of LEDGER_KEYS)
			ledger[k] = withPowerups.reduce((s, g) => s + g.teams[ti].ledger[k], 0) / runs;
		const finalNoPowerups = noPowerups.reduce((s, g) => s + g.teams[ti].ledger.final, 0) / runs;
		const byType: Record<string, number> = {};
		const byCh = new Array(challengeCount).fill(0);
		const firstSum: Record<string, number> = {};
		const firstN: Record<string, number> = {};
		let total = 0;
		for (const g of withPowerups) {
			const seen = new Set<string>();
			for (const e of g.teams[ti].earned) {
				byType[e.typeId] = (byType[e.typeId] ?? 0) + 1;
				byCh[e.challengeIndex] += 1;
				total += 1;
				if (!seen.has(e.typeId)) {
					seen.add(e.typeId);
					firstSum[e.typeId] = (firstSum[e.typeId] ?? 0) + e.challengeIndex + 1;
					firstN[e.typeId] = (firstN[e.typeId] ?? 0) + 1;
				}
			}
		}
		for (const k of Object.keys(byType)) byType[k] /= runs;
		const firstEarnAt: Record<string, number> = {};
		for (const k of Object.keys(firstSum)) firstEarnAt[k] = firstSum[k] / firstN[k];
		const pctPerChallenge = new Array(challengeCount)
			.fill(0)
			.map(
				(_, ci) =>
					withPowerups.reduce((s, g) => s + (g.teams[ti].perChallengePct[ci] ?? 0), 0) / runs
			);
		const pctPerChallengeNoPowerups = new Array(challengeCount)
			.fill(0)
			.map(
				(_, ci) => noPowerups.reduce((s, g) => s + (g.teams[ti].perChallengePct[ci] ?? 0), 0) / runs
			);
		return {
			name: spec.name,
			level: spec.level,
			ledger,
			finalNoPowerups,
			earnedPerGame: total / runs,
			earnedByType: byType,
			earnedByChallenge: byCh.map((n) => n / runs),
			firstEarnAt,
			pctPerChallenge,
			pctPerChallengeNoPowerups
		};
	});
	const gapOf = (games: GameOutcome[]) =>
		games.reduce((s, g) => {
			const f = g.teams.map((t) => t.ledger.final);
			return s + (Math.max(...f) - Math.min(...f));
		}, 0) / games.length;
	const battleTotal = specs.map(
		(_, ti) =>
			withPowerups.reduce((s, g) => s + g.battleAwards.reduce((a, row) => a + row[ti], 0), 0) / runs
	);
	return {
		label,
		runs,
		teams,
		gap: gapOf(withPowerups),
		gapNoPowerups: gapOf(noPowerups),
		battleTotal
	};
}

const r0 = (n: number) => String(Math.round(n));
const r1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const pctS = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)} %` : '–');

export function renderMarkdown(
	aggs: Aggregate[],
	meta: {
		setName: string;
		runs: number;
		seed: number;
		fixes: string[];
		challengeTitles: string[];
		scenario: string;
		notes: string[];
	}
): string {
	const L: string[] = [];
	L.push(`# Balans-simulatie — ${meta.setName}`);
	L.push('');
	L.push(
		`Scenario **${meta.scenario}** · ${meta.runs} runs per variant · seed ${meta.seed} · ${meta.challengeTitles.length} challenges`
	);
	L.push(`Virtuele datafixes: ${meta.fixes.length ? meta.fixes.join('; ') : 'geen'}`);
	for (const n of meta.notes) L.push(`> ${n}`);
	L.push('');

	// ── Overzicht ────────────────────────────────────────────────────────────
	L.push('## Eindstand per variant (gemiddeld)');
	L.push('');
	const header = [
		'Variant',
		...aggs[0].teams.map((t) => `${t.name} (${t.level} %)`),
		'Gat 1e–laatste',
		'Gat zonder powerups'
	];
	L.push(`| ${header.join(' | ')} |`);
	L.push(`|${header.map(() => '---').join('|')}|`);
	for (const a of aggs)
		L.push(
			`| ${a.label} | ${a.teams.map((t) => r0(t.ledger.final)).join(' | ')} | **${r0(a.gap)}** | ${r0(a.gapNoPowerups)} |`
		);
	L.push('');

	for (const a of aggs) {
		L.push(`## ${a.label}`);
		L.push('');
		L.push('### Opsplitsing van de eindstand');
		L.push('');
		L.push(
			'| Team | Eind | Verplicht (base) | Bonusvelden | Battles | Comeback ×1,5 | Powerup-mult | Onthullers | Directe pts | Insurance | Resurrection | Streak | Speed | Kroon | Aanval-verlies | Door powerups bepaald | Comeback vuurde |'
		);
		L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
		for (const t of a.teams) {
			const l = t.ledger;
			const powerupPts =
				l.powerupMultDelta +
				l.revealPoints +
				l.directPoints +
				l.insuranceDelta +
				l.resurrectionDelta;
			L.push(
				`| ${t.name} | **${r0(l.final)}** | ${r0(l.base)} | ${r0(l.bonusFields)} | ${r0(l.battle)} | +${r0(l.comebackDelta)} | ${r0(l.powerupMultDelta)} | ${r0(l.revealPoints)} | ${r0(l.directPoints)} | ${r0(l.insuranceDelta)} | ${r0(l.resurrectionDelta)} | ${r0(l.streak)} | ${r0(l.speed)} | ${r0(l.crown)} | −${r0(l.attackLoss)} | ${r0(powerupPts)} (${pctS(powerupPts, l.final)}) · Δ t.o.v. zonder: ${r0(l.final - t.finalNoPowerups)} | ${r1(l.comebackFired)}× |`
			);
		}
		L.push('');
		L.push(
			'"Door powerups bepaald" = multiplier-delta + onthullers + directe punten + insurance + resurrection. "Δ t.o.v. zonder" = eindstand min dezelfde run zonder powerups (bevat ook indirecte effecten zoals battle-verschuivingen en aanvallen).'
		);
		L.push('');

		L.push('### Powerups per niveau — hoeveel, welke, wanneer');
		L.push('');
		L.push(
			`| Team | Per spel | Per challenge (${meta.challengeTitles.map((t, i) => `C${i + 1}`).join(' / ')}) | Welke (gem. per spel, cat., 1e keer bij challenge #) |`
		);
		L.push('|---|---:|---|---|');
		for (const t of a.teams) {
			const types = Object.entries(t.earnedByType)
				.sort((x, y) => y[1] - x[1])
				.map(([id, n]) => `${id} ${r1(n)}× [${CATEGORIE[id] ?? '?'}, C${r1(t.firstEarnAt[id])}]`)
				.join(', ');
			L.push(
				`| ${t.name} | ${r1(t.earnedPerGame)} | ${t.earnedByChallenge.map(r1).join(' / ')} | ${types || '—'} |`
			);
		}
		L.push('');
		L.push('### Gemiddeld verdien-% per challenge — met powerups (zonder powerups)');
		L.push('');
		L.push(
			`| Team | ${meta.challengeTitles.map((t) => t.replace('Vrienden Weekend 2026 ', '')).join(' | ')} |`
		);
		L.push(`|---|${meta.challengeTitles.map(() => '---:').join('|')}|`);
		for (const t of a.teams)
			L.push(
				`| ${t.name} | ${t.pctPerChallenge.map((p, i) => `${r0(p)} % (${r0(t.pctPerChallengeNoPowerups[i])} %)`).join(' | ')} |`
			);
		L.push('');
	}
	return L.join('\n');
}
