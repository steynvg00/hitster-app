// verify-earn-form.ts — UI-stap 2: de earn-requirements zijn instelbaar,
// wisbaar, en een save overschrijft niets anders.
//
// Draaien: npm run bots:verify-earn-form
//
// Puur op één blok na: de catalogus wordt read-only gelezen (SELECT op
// powerup_types) zodat blok D over de échte types gaat. Er wordt NIETS
// geschreven — de save-keten wordt gedreven tegen een in-memory config, precies
// de vorm die de actie ook doorloopt (parseEarnFields → applyOverridePatch →
// mergeConfigPatch).
//
// ── Wat bewezen moet worden ────────────────────────────────────────────────
//
//   A. DE PARSE. Afwezig ≠ leeg. Een veld dat niet meegestuurd is blijft staan;
//      een leeg veld WIST; een ongeldige waarde laat de opgeslagen waarde met
//      rust. Plus: de chance-conversie is over het hele bereik 0–100 bit-voor-bit
//      gelijk aan de expressie die de actie vóór deze stap gebruikte — de
//      migratie van dat ene bestaande veld mag niets veranderd hebben.
//   B. EEN SAVE SCHRIJFT ALLEEN WAT ER IN ZAT. Eén earn-key zetten laat de
//      andere earn-keys, de sterkte-keys, de vangnet-modifiers, de andere types
//      en de token-shop-familie exact zoals ze waren.
//   C. WISSEN. Een leeg veld verwijdert de key, waarna de resolver-default weer
//      geldt — aangetoond via buildPowerupConsoleRows, dus zoals de console het
//      daarna toont. Inclusief has_override, dat bij een leeggemaakte override
//      weer uit moet.
//   D. DE RACE. Vier gelijktijdige saves op vier verschillende keys. Mét
//      withRowLock overleven alle vier. ZONDER het slot gaan er keys verloren —
//      dat tweede deel is er om te bewijzen dat deze harnas de race überhaupt
//      kán zien; zonder die controle is "alle vier aanwezig" ook waar als er
//      niets geraced heeft.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import {
	parseEarnFields,
	applyOverridePatch,
	EARN_FIELDS
} from '../../src/lib/server/powerup-save';
import { withRowLock } from '../../src/lib/server/config-lock';
import { mergeConfigPatch, parseConfig, type PowerupType } from '../../src/lib/server/powerups';
import { buildPowerupConsoleRows } from '../../src/lib/server/powerup-console';
import type { PowerupTypeOverride } from '../../src/lib/types';

let passed = 0;
let failed = 0;

function check(name: string, got: unknown, want: unknown) {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (ok) passed++;
	else failed++;
	console.log(
		`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`
	);
}
const checkTrue = (name: string, got: boolean) => check(name, got, true);

/** Een formulier als map: ontbrekende sleutel = veld niet meegestuurd. */
const reader = (fields: Record<string, string>) => (name: string) =>
	name in fields ? fields[name] : null;

/**
 * De save-keten van ?/saveTypeConfig, zonder database: exact de drie stappen die
 * de actie doorloopt (+page.server.ts, saveTypeConfig).
 */
function saveEarn(rawConfig: unknown, typeId: string, fields: Record<string, string>): unknown {
	const patch = parseEarnFields(reader(fields));
	const current = parseConfig(rawConfig);
	const nextOverride = applyOverridePatch(current.types[typeId], patch);
	return mergeConfigPatch(rawConfig, { types: { [typeId]: nextOverride } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── De live catalogus (alleen voor blok C) ───────────────────────────────────
const env = Object.fromEntries(
	readFileSync('.env', 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.trim().startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [
				l.slice(0, i).trim(),
				l
					.slice(i + 1)
					.trim()
					.replace(/^["']|["']$/g, '')
			];
		})
);
const db = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: catalogRaw, error } = await db.from('powerup_types').select('*').order('sort_order');
if (error || !catalogRaw?.length) {
	console.log(`Kon de catalogus niet lezen: ${error?.message ?? 'leeg'}`);
	process.exit(1);
}
const catalog = catalogRaw as PowerupType[];

console.log(`\n▶ earn-form — clear-semantiek + race-veiligheid (${catalog.length} types)\n`);

// ─────────────────────────────────────────────────────────────────────────────
console.log('══ A. De parse: afwezig ≠ leeg ≠ ongeldig ══\n');

{
	check('afwezig veld raakt niets aan', parseEarnFields(reader({})), { set: {}, clear: [] });

	check('leeg veld wist', parseEarnFields(reader({ weight: '' })), { set: {}, clear: ['weight'] });
	check('spaties tellen als leeg', parseEarnFields(reader({ weight: '   ' })), {
		set: {},
		clear: ['weight']
	});

	check('geldige waarde wordt gezet', parseEarnFields(reader({ weight: '3' })), {
		set: { weight: 3 },
		clear: []
	});
	check('weight 0 is geldig (nooit getrokken)', parseEarnFields(reader({ weight: '0' })), {
		set: { weight: 0 },
		clear: []
	});
	check('negatief weight wordt geweigerd, niet gewist', parseEarnFields(reader({ weight: '-2' })), {
		set: {},
		clear: []
	});
	check('pct buiten bereik geweigerd', parseEarnFields(reader({ min_score_pct: '140' })), {
		set: {},
		clear: []
	});
	check('onzin geweigerd', parseEarnFields(reader({ max_score_pct: 'abc' })), {
		set: {},
		clear: []
	});

	// Het formulier van de compacte kaart stuurt alléén `enabled` — geen van de
	// vier earn-velden mag daardoor verdwijnen.
	check('een form zonder earn-velden wist er geen', parseEarnFields(reader({ enabled: 'true' })), {
		set: {},
		clear: []
	});

	// Alle vier tegelijk, zoals het echte earn-formulier ze post.
	check(
		'het hele formulier in één submit',
		parseEarnFields(
			reader({ chance: '25', weight: '2', min_score_pct: '10', max_score_pct: '90' })
		),
		{ set: { chance: 0.25, weight: 2, min_score_pct: 10, max_score_pct: 90 }, clear: [] }
	);
	check(
		'gemengd: twee gezet, twee gewist',
		parseEarnFields(reader({ chance: '25', weight: '', min_score_pct: '', max_score_pct: '90' })),
		{ set: { chance: 0.25, max_score_pct: 90 }, clear: ['weight', 'min_score_pct'] }
	);

	// ── Chance-pariteit met de expressie die hier stond ────────────────────────
	// Oud (+page.server.ts, vóór deze stap):
	//   const pct = parseInt(raw, 10);
	//   if (!isNaN(pct) && pct >= 0 && pct <= 100) patch.chance = pct / 100;
	const oldChance = (raw: string): number | undefined => {
		const pct = parseInt(raw, 10);
		if (!isNaN(pct) && pct >= 0 && pct <= 100) return pct / 100;
		return undefined;
	};
	let compared = 0;
	const mismatches: string[] = [];
	for (let pct = 0; pct <= 100; pct++) {
		const raw = String(pct);
		const nw = parseEarnFields(reader({ chance: raw })).set.chance;
		compared++;
		if (nw !== oldChance(raw)) mismatches.push(`${raw}: ${nw} ≠ ${oldChance(raw)}`);
	}
	check('chance-conversie identiek over het hele bereik', mismatches, []);
	check('en er is echt vergeleken', compared, 101);

	// De twee plekken waar de nieuwe parse STRENGER is dan de oude. Beide zijn
	// onbereikbaar via het formulier (een <input type=number step=1 min=0 max=100>
	// laat requestSubmit niet door bij zo'n waarde), en beide zijn de goede kant
	// op: een geweigerde waarde laat de laatste goede staan, waar de oude parse
	// stilletjes iets opsloeg dat de host niet had getypt.
	check('oud kapte "50.7" af tot 50', oldChance('50.7'), 0.5);
	check('nieuw weigert het', parseEarnFields(reader({ chance: '50.7' })).set.chance, undefined);
	check('oud accepteerde "50abc"', oldChance('50abc'), 0.5);
	check('nieuw weigert het', parseEarnFields(reader({ chance: '50abc' })).set.chance, undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ B. Een save schrijft alleen wat er in zat ══\n');

// Een set met alle drie de sleutel-families gevuld, plus een tweede type.
const RICH = {
	thresholds_percent: [25, 50, 75],
	threshold_mode: 'per_challenge',
	band_mode: 'all_bands',
	// De token-shop-familie: parseConfig modelleert die NIET. Dit is de
	// feast-set-landmijn — als een save hier doorheen walst is die terug.
	starting_tokens: 4,
	per_correct_challenge: 2,
	streak_bonuses: [{ streak: 3, bonus: 2 }],
	time_tick_minutes: 10,
	tokens_per_tick: 1,
	computed_set_max: 555,
	categories: { offensive: false },
	types: {
		shield: {
			enabled: true,
			chance: 0.4,
			weight: 2,
			min_score_pct: 20,
			max_score_pct: 80,
			weight_modifier: { factor: 2, conditions: [{ axis: 'position', lte: 0.33 }] }
		},
		lucky_dice: { dice_min: 2, dice_max: 12 },
		x_ray: { reveal_budget: 9 }
	}
};

{
	// Eén earn-key zetten.
	const next = saveEarn(RICH, 'shield', { weight: '5' }) as Record<string, unknown>;
	const types = (next.types ?? {}) as Record<string, PowerupTypeOverride>;

	check('de gezette key is gewijzigd', types.shield.weight, 5);
	check(
		'de andere earn-keys van dit type blijven',
		[types.shield.chance, types.shield.min_score_pct, types.shield.max_score_pct],
		[0.4, 20, 80]
	);
	check('enabled blijft', types.shield.enabled, true);
	check('de vangnet-modifier blijft', types.shield.weight_modifier, {
		factor: 2,
		conditions: [{ axis: 'position', lte: 0.33 }]
	});
	check(
		'sterkte-keys van ANDERE types blijven',
		[types.lucky_dice, types.x_ray],
		[{ dice_min: 2, dice_max: 12 }, { reveal_budget: 9 }]
	);
	check(
		'de token-shop-familie overleeft',
		[
			next.starting_tokens,
			next.per_correct_challenge,
			next.streak_bonuses,
			next.time_tick_minutes,
			next.tokens_per_tick
		],
		[4, 2, [{ streak: 3, bonus: 2 }], 10, 1]
	);
	check('computed_set_max overleeft', next.computed_set_max, 555);
	check('categories overleeft', next.categories, { offensive: false });
	check('de ladder overleeft', next.thresholds_percent, [25, 50, 75]);

	// Sterkte-keys van HETZELFDE type mogen ook niet sneuvelen bij een earn-save.
	const diceNext = saveEarn(RICH, 'lucky_dice', { chance: '10' }) as Record<string, unknown>;
	const diceTypes = (diceNext.types ?? {}) as Record<string, PowerupTypeOverride>;
	check('earn-save laat de sterkte-keys van hetzelfde type staan', diceTypes.lucky_dice, {
		dice_min: 2,
		dice_max: 12,
		chance: 0.1
	});
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ C. Wissen: de key gaat weg, de default komt terug ══\n');

{
	const cleared = saveEarn(RICH, 'shield', { weight: '' }) as Record<string, unknown>;
	const types = (cleared.types ?? {}) as Record<string, PowerupTypeOverride>;

	checkTrue('de key is echt weg (niet op null/0 gezet)', !('weight' in types.shield));
	check('de rest van de override blijft', Object.keys(types.shield).sort(), [
		'chance',
		'enabled',
		'max_score_pct',
		'min_score_pct',
		'weight_modifier'
	]);

	// En zoals de console het daarna toont: terug naar de resolver-default.
	const rows = buildPowerupConsoleRows(cleared, catalog);
	const shield = rows.find((r) => r.id === 'shield');
	check(
		'de row toont weer de default',
		[shield?.weight.value, shield?.weight.source],
		[1, 'default']
	);

	// Alles wissen → een lege override. has_override moet dan uit, anders blijft de
	// kaart "edited" tonen zonder dat de host dat ooit nog kwijtraakt.
	let stripped: unknown = RICH;
	for (const f of EARN_FIELDS) stripped = saveEarn(stripped, 'free_answer', { [f]: '' });
	stripped = saveEarn(stripped, 'free_answer', {
		chance: '',
		weight: '',
		min_score_pct: '',
		max_score_pct: ''
	});
	const freshRows = buildPowerupConsoleRows(stripped, catalog);
	const fa = freshRows.find((r) => r.id === 'free_answer');
	check('een leeggemaakte override telt niet als "edited"', fa?.has_override, false);
	check(
		'en alles staat weer op default',
		[fa?.chance.source, fa?.weight.source],
		['default', 'default']
	);

	// Een verse set waar niets in staat: wissen mag geen ravage aanrichten.
	const fresh = saveEarn({ thresholds_percent: [50] }, 'shield', { weight: '' }) as Record<
		string,
		unknown
	>;
	check('wissen op een verse set is onschadelijk', fresh.thresholds_percent, [50]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ D. De race: vier gelijktijdige saves ══\n');

{
	/**
	 * Eén save zoals de actie hem doet: lezen, even wachten (het venster waarin
	 * een tweede request ertussen komt), mergen, schrijven.
	 */
	async function racingSave(
		store: { config: unknown },
		typeId: string,
		fields: Record<string, string>,
		delay: number
	) {
		const raw = store.config; // READ
		await sleep(delay); // het venster
		store.config = saveEarn(raw, typeId, fields); // MERGE + WRITE
	}

	const saves: Array<[string, Record<string, string>, number]> = [
		['shield', { weight: '7' }, 30],
		['shield', { chance: '10' }, 20],
		['shield', { min_score_pct: '5' }, 10],
		['shield', { max_score_pct: '95' }, 0]
	];

	// ── Zonder slot: de race die deze stap dicht moet zetten ──────────────────
	{
		const store = { config: { types: {} } as unknown };
		await Promise.all(saves.map(([t, f, d]) => racingSave(store, t, f, d)));
		const ov = (
			(store.config as Record<string, unknown>).types as Record<string, PowerupTypeOverride>
		).shield;
		const survivors = Object.keys(ov ?? {}).sort();
		checkTrue(
			`ZONDER slot gaan er saves verloren (over: ${survivors.join(', ') || 'niets'})`,
			survivors.length < 4
		);
	}

	// ── Met slot: elke save leest wat de vorige schreef ───────────────────────
	{
		const store = { config: { types: {} } as unknown };
		await Promise.all(
			saves.map(([t, f, d]) =>
				withRowLock('powerup_config:set-1', () => racingSave(store, t, f, d))
			)
		);
		const ov = (
			(store.config as Record<string, unknown>).types as Record<string, PowerupTypeOverride>
		).shield;
		check('MET slot overleven alle vier', Object.keys(ov ?? {}).sort(), [
			'chance',
			'max_score_pct',
			'min_score_pct',
			'weight'
		]);
		check(
			'…met de juiste waarden',
			[ov.weight, ov.chance, ov.min_score_pct, ov.max_score_pct],
			[7, 0.1, 5, 95]
		);
	}

	// Twee verschillende sets mogen elkaar NIET blokkeren — het slot is per rij.
	{
		const order: string[] = [];
		await Promise.all([
			withRowLock('powerup_config:A', async () => {
				await sleep(30);
				order.push('A');
			}),
			withRowLock('powerup_config:B', async () => {
				await sleep(5);
				order.push('B');
			})
		]);
		check('het slot is per set, niet globaal', order, ['B', 'A']);
	}

	// Een mislukte save mag de wachtrij niet blokkeren.
	{
		const done: string[] = [];
		const boom = withRowLock('powerup_config:C', async () => {
			throw new Error('save faalde');
		}).catch(() => done.push('fout afgevangen'));
		const after = withRowLock('powerup_config:C', async () => {
			done.push('volgende save draaide toch');
		});
		await Promise.all([boom, after]);
		check('een fout wedgt de wachtrij niet', done, [
			'fout afgevangen',
			'volgende save draaide toch'
		]);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══ E. De bedrading: post het formulier wat de server leest? ══\n');

// De blokken hierboven bewijzen de KETEN, met veldnamen die uit EARN_FIELDS
// komen. Ze kunnen niet bewijzen dat het formulier diezelfde namen post en dat
// de actie die parser ook echt aanroept. Dat leest dit blok uit de bron — de
// techniek die verify-config-merge-safe part 2 gebruikt voor precies dezelfde
// soort gat.
{
	const svelte = readFileSync('src/routes/admin/sets/[id]/+page.svelte', 'utf8');
	const server = readFileSync('src/routes/admin/sets/[id]/+page.server.ts', 'utf8');

	const missing = EARN_FIELDS.filter((f) => !svelte.includes(`name="${f}"`));
	check('elk earn-veld heeft een input in het formulier', missing, []);

	// Eén form voor alle vier, anders staan ze in losse forms: dan is de
	// cross-field-regel (min ≤ max) niet te beoordelen en is de race terug.
	// Opgezocht door de bron op <form> te splitsen en te vragen of ÉÉN segment ze
	// alle vier draagt — ongevoelig voor hoe prettier het indenteert.
	const formBlocks = svelte
		.split('<form')
		.slice(1)
		.map((b) => b.slice(0, b.indexOf('</form>')));
	const combined = formBlocks.filter((b) => EARN_FIELDS.every((f) => b.includes(`name="${f}"`)));
	check('precies één form draagt alle vier de velden', combined.length, 1);
	checkTrue(
		'en dat is een saveTypeConfig-form',
		combined[0]?.includes('?/saveTypeConfig') ?? false
	);

	checkTrue('de actie roept de gedeelde parser aan', server.includes('parseEarnFields('));
	checkTrue('…en de patch-toepasser', server.includes('applyOverridePatch('));
	checkTrue('…binnen het per-set slot', server.includes('withRowLock(`powerup_config:'));
	checkTrue(
		'de oude inline chance-parse is weg',
		!server.includes('parseInt(chanceRaw, 10)') && !server.includes('const chanceRaw')
	);
	// De write-grens die verify-config-merge-safe bewaakt, moet in de actie blijven
	// staan — een save die buiten mergeConfigPatch om schrijft is de landmijn.
	checkTrue(
		'de save merget nog steeds op de opgeslagen config',
		server.includes('mergeConfigPatch(')
	);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} geslaagd, ${failed} gefaald\n`);
process.exit(failed === 0 ? 0 : 1);
