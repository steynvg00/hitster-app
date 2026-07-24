// C3b diagnose-probe — tijdelijk script, GEEN onderdeel van de verify-suite.
// Roept resolveTabFields (src/lib/server/scoring.ts) direct aan met in-memory
// argumenten. Raakt GEEN database, GEEN netwerk, GEEN SvelteKit runtime.
//
// Waarom deze probe bestaat: in C3b staat er nog geen admin-UI, dus elke rij in
// de DB blijft NULL. Een groene harness bewijst daarom alleen de FALLBACK-tak.
// Deze probe voedt resolveTabFields rechtstreeks een non-NULL override, zodat
// ook de OVERRIDE-tak en de randgevallen aantoonbaar zijn.
//
// De "challenge" is variant 'normal' (artist, title, year) ZONDER
// points_config.fields[], dus de challenge-brede resolutie levert exact 3 velden.
//
// Draaien: npx tsx tests/scratch/c3b-fields-probe.ts

import { resolveTabFields, type ResolvedField } from '../../src/lib/server/scoring';

const challenge = { variant: 'normal', points_config: {} };

function names(frs: ResolvedField[]): string {
	return frs.map((f) => `${f.name}(${f.input_mode},${f.max_points}${f.is_bonus ? ',bonus' : ''})`).join(', ');
}

function runCase(name: string, tab: { fields?: unknown } | null, expected: string) {
	const result = resolveTabFields(tab, challenge);
	console.log(`=== ${name} ===`);
	console.log(`tab.fields = ${JSON.stringify(tab?.fields)}`);
	console.log(`verwacht  : ${expected}`);
	console.log(`resultaat : [${names(result)}]  (${result.length} veld(en))`);
	console.log(`RAW ${JSON.stringify(result)}`);
	console.log('');
}

// A — tab.fields NULL, challenge heeft 3 velden → verwacht: die 3 (inherit).
runCase('CASE A (fields = null → inherit)', { fields: null }, 'artist, title, year (challenge-breed)');

// B — tab.fields = 2 afwijkende velden → verwacht: die 2 (override).
runCase(
	'CASE B (fields = 2 velden → override)',
	{
		fields: [
			{ name: 'title', input_mode: 'open_text', max_points: 5, is_bonus: false },
			{ name: 'year', input_mode: 'slider', max_points: 7, is_bonus: false }
		]
	},
	'title, year (tab-override)'
);

// C — tab.fields = [] (lege array) → gekozen gedrag: inherit.
runCase('CASE C (fields = [] → inherit)', { fields: [] }, 'artist, title, year (leeg = geen override)');

// D — tab.fields = malformed (geen array) → gekozen gedrag: inherit.
runCase(
	'CASE D (fields = malformed → inherit)',
	{ fields: 'kapot' },
	'artist, title, year (malformed = geen override)'
);
