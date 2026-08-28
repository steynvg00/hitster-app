// Balans-simulator — rekent een echte set door met teams van verschillend
// niveau, over alle challenges, inclusief battles, comeback, streak/speed en
// powerups (echte ladder, echte scorer). Leest de set read-only uit Supabase
// (of uit een dump) en SCHRIJFT NIETS.
//
//   npm run bots:balance-sim -- [opties]
//
// Opties:
//   --set <uuid>          set-id (default: Vrienden Weekend 2026)
//   --dump <pad>          lees de set uit een eerder opgeslagen JSON-dump i.p.v. de DB
//   --save-dump <pad>     sla de opgehaalde set op als dump (voor offline runs)
//   --variants a,b,c      welke configvarianten (default: alle; zie balance-sim/configs.ts)
//   --levels 95,70,45,20  niveaus van de teams (aantal = aantal teams)
//   --scenario all-low    voorgedefinieerd: levels 40,35,30,25,25
//   --runs 200            aantal Monte-Carlo-runs per variant
//   --seed 1              RNG-seed (reproduceerbaar)
//   --streak 3:10         streak_config aan (3 op rij = +10) — vergelijking apart gerapporteerd
//   --speed 60            speed_threshold_seconds aan — idem
//   --no-fixes            de bekende datafouten (Icons-posities, Anthems-dubbel) NIET virtueel fixen
//   --print-config <key>  druk de ruwe powerup_config van een variant af (om in de DB te plakken) en stop
//   --out <pad>           schrijf het rapport naar een bestand (default: alleen stdout)
//
// Voorbeelden:
//   npm run bots:balance-sim
//   npm run bots:balance-sim -- --scenario all-low --runs 500
//   npm run bots:balance-sim -- --variants indeling --streak 3:10 --speed 60
//   npm run bots:balance-sim -- --print-config indeling

import { writeFileSync } from 'node:fs';
import { fetchDump, readDump, saveDump, buildSet } from './balance-sim/load';
import { VARIANTS, variantByKey } from './balance-sim/configs';
import { runGame } from './balance-sim/engine';
import { aggregate, renderMarkdown, type Aggregate } from './balance-sim/report';
import { makeRng } from './balance-sim/rng';
import type { TeamSpec } from './balance-sim/types';

const DEFAULT_SET = '72ee8093-844d-4393-ae86-8ff6c820de9b';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
	const setId = arg('set') ?? DEFAULT_SET;
	const dumpPath = arg('dump');
	const dump = dumpPath ? readDump(dumpPath) : await fetchDump(setId);
	if (arg('save-dump')) saveDump(dump, arg('save-dump')!);

	const fixes = !flag('no-fixes');
	const runs = Number(arg('runs') ?? 200);
	const seed = Number(arg('seed') ?? 1);
	const scenario = arg('scenario');
	const levelsRaw = arg('levels') ?? (scenario === 'all-low' ? '40,35,30,25,25' : '95,70,45,20,20');
	const levels = levelsRaw.split(',').map(Number);
	const teams: TeamSpec[] = levels.map((l, i) => ({ name: `T${i + 1}`, level: l }));
	const variantKeys = (arg('variants') ?? VARIANTS.map((v) => v.key).join(',')).split(',');

	const streakArg = arg('streak');
	const streak = streakArg
		? [{ streak: Number(streakArg.split(':')[0]), bonus: Number(streakArg.split(':')[1]) }]
		: null;
	const speed = arg('speed') ? Number(arg('speed')) : null;

	if (arg('print-config')) {
		const v = variantByKey(arg('print-config')!);
		const set = buildSet(dump, { fixes });
		console.log(JSON.stringify(v.powerupConfig(set.rawPowerupConfig), null, 2));
		return;
	}

	const aggs: Aggregate[] = [];
	const notes: string[] = [];
	let fixesApplied: string[] = [];
	let challengeTitles: string[] = [];

	const runVariant = (
		label: string,
		key: string,
		extra: { streak: typeof streak; speed: number | null }
	) => {
		const v = variantByKey(key);
		const set = buildSet(dump, { fixes, fieldOverrides: v.fieldOverrides });
		fixesApplied = set.fixesApplied;
		challengeTitles = set.challenges.map((c) => c.title);
		const raw = v.powerupConfig(set.rawPowerupConfig);
		const withP = [];
		const withoutP = [];
		for (let r = 0; r < runs; r++) {
			const opts = {
				teams,
				rawPowerupConfig: raw,
				streakThresholds: extra.streak,
				speedThresholdSeconds: extra.speed
			};
			withP.push(runGame(set, { ...opts, powerupsEnabled: true }, makeRng(seed * 100003 + r)));
			withoutP.push(runGame(set, { ...opts, powerupsEnabled: false }, makeRng(seed * 100003 + r)));
		}
		aggs.push(aggregate(label, teams, withP, withoutP, set.challenges.length));
	};

	for (const key of variantKeys) {
		runVariant(variantByKey(key).label, key, { streak: null, speed: null });
		if (streak || speed) {
			runVariant(
				`${variantByKey(key).label} + streak ${streakArg ?? 'uit'} / speed ${speed ?? 'uit'} s`,
				key,
				{ streak, speed }
			);
		}
	}

	notes.push(
		'Teammodel: niveau L = kans dat een veld volledig goed is; fout jaar 30/20/50 % er 1/2/≥3 naast; foute tekst leeg; artiesten per naam; grouping alles-of-niets. Zie balance-sim/team-model.ts.'
	);
	notes.push(
		'Bot-beleid: alles wat op de volgende challenge kan werken wordt daar ingezet; aanvallen op de leider; Double Down voorspelt niveau − 15; Insurance alleen bij niveau < 55; Resurrection op de slechtste challenge (replace). Zie balance-sim/engine.ts.'
	);
	notes.push(
		'Tijd-aanvallen: time_drain −2 %, freeze −4 %, tap_to_break −2 % nauwkeurigheid op die challenge (12-minutenklok). Hard Gaan geldt voor precies de volgende challenge.'
	);

	const md = renderMarkdown(aggs, {
		setName: dump.set.name as string,
		runs,
		seed,
		fixes: fixesApplied,
		challengeTitles,
		scenario: scenario ?? `levels ${levelsRaw}`,
		notes
	});
	console.log(md);
	if (arg('out')) writeFileSync(arg('out')!, md);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
