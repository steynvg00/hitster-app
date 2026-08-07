// 0077 field-count probe — in-memory, GEEN database, GEEN netwerk.
// Roept scoreSubmission (src/lib/server/scoring.ts) direct aan en toont de
// (fields_correct, fields_total) die submit.ts op de submission-rij zou schrijven.
//
// Waarom in-memory: de telling is een pure functie van de scoring-uitkomst. Door
// scoreSubmission rechtstreeks te voeren met bekende antwoorden is elk cijfer met
// de hand na te rekenen, zonder de live database (waar migratie 0077 nog niet is
// gedraaid).
//
// Stubs: TrackData als plain object, open_text voor alle velden (geen pool-
// afhankelijkheid), fieldPoints {} → DEFAULT_FIELD_MAX (10 per veld).
//
// Draaien: npx tsx tests/scratch/fields-correct-probe.ts

import { scoreSubmission, type TabInput, type TrackData } from '../../src/lib/server/scoring';
import type { AnswerField, InputMode } from '../../src/lib/types/index';

const FIELDS = ['artist', 'title', 'year'] as AnswerField[];
const MODES: Record<string, InputMode> = {
	artist: 'open_text',
	title: 'open_text',
	year: 'open_text'
};
const POINTS: Record<string, number> = {}; // → DEFAULT_FIELD_MAX (10 per veld)

const TRACK: TrackData = {
	id: 'track-1',
	artist: 'Headhunterz',
	title: 'Dragonborn',
	year: 2012
} as TrackData;

function tab(fieldValues: Record<string, string>): TabInput[] {
	return [
		{
			tabId: 'tab-1',
			tabPosition: 1,
			sourceTracks: [
				{ id: 'src-1', tabId: 'tab-1', trackId: 'track-1', sortOrder: 0, track: TRACK }
			],
			clips: [],
			playerDraft: [{ fieldValues }]
		} as unknown as TabInput
	];
}

let failures = 0;

function run(
	name: string,
	fieldValues: Record<string, string>,
	wantCorrect: number,
	wantTotal: number,
	why: string,
	bonusFields = new Set<string>()
) {
	const { result } = scoreSubmission(tab(fieldValues), FIELDS, MODES, POINTS, undefined, bonusFields);
	const got = `${result.fieldsCorrect}/${result.fieldsTotal}`;
	const want = `${wantCorrect}/${wantTotal}`;
	const ok = got === want;
	if (!ok) failures++;
	console.log(`${ok ? '✅' : '❌'} ${name.padEnd(46)} ${got.padEnd(7)} (verwacht ${want})`);
	console.log(`   ${why}`);
	console.log(
		`   per veld: ${result.tabs[0].slots[0].fields
			.map((f) => `${f.field}=${f.score}/${f.maxScore}`)
			.join('  ')}`
	);
	console.log('');
}

console.log('\n══ 0077: (fields_correct, fields_total) uit scoreSubmission ══\n');
console.log(`Track: ${TRACK.artist} — ${TRACK.title} (${TRACK.year}), 10 pt per veld\n`);

// HET GEVRAAGDE VOORBEELD: 2 van 3 velden goed.
run(
	'2 van 3 goed (jaar 2 ernaast)',
	{ artist: 'Headhunterz', title: 'Dragonborn', year: '2014' },
	2,
	3,
	'artist + title exact = vol; jaar ±2 = 20% van 10 = 2 pt → GEEN volle punten → fout.'
);

run(
	'alles goed',
	{ artist: 'Headhunterz', title: 'Dragonborn', year: '2012' },
	3,
	3,
	'drie velden op volle punten.'
);

run(
	'lege inzending (auto-submit / backstop)',
	{},
	0,
	3,
	'0 goed, maar total = 3 — een gemeten 0%, NIET 0/0 of NULL. Dit is het geval dat het vangnet moet zien.'
);

run(
	'jaar 1 ernaast telt als FOUT',
	{ artist: 'Headhunterz', title: 'Dragonborn', year: '2013' },
	2,
	3,
	'jaar ±1 = 50% van 10 = 5 pt. Deelpunten zijn GEEN "goed" — dezelfde lat als fieldIsFullyCorrect (lifeline).'
);

run(
	'typefout binnen de 80%-drempel telt als GOED',
	{ artist: 'Headhunterz', title: 'Dragonbrn', year: '2012' },
	3,
	3,
	'"Dragonbrn" ≥ 0.80 similarity → volle punten → goed. Bestaande open_text-drempel, niet nieuw.'
);

run(
	'zwakke gok (65–80%) telt als FOUT',
	{ artist: 'Headhunterz', title: 'Dragon', year: '2012' },
	2,
	3,
	'"Dragon" haalt de 50%-band, niet de volle → fout, consistent met de lifeline-lat.'
);

run(
	'bonusveld valt uit TELLER én NOEMER',
	{ artist: 'Headhunterz', title: 'Dragonborn', year: '2012' },
	2,
	2,
	'year als bonus gemarkeerd → total zakt van 3 naar 2, ook al is het goed beantwoord. Spiegelt thresholdOfFields.',
	new Set(['year'])
);

console.log(
	failures === 0
		? `GROEN: alle ${7} gevallen kloppen met de gekozen definitie.\n`
		: `ROOD: ${failures} geval(len) wijken af.\n`
);
process.exit(failures === 0 ? 0 : 1);
