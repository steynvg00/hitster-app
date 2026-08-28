// GEDRAGSCONTROLE voor de toetsenbordmeting achter de powerup-balk (scherm 7B).
//
//   npm run bots:verify-keyboard-inset
//
// ── Waar dit over gaat ───────────────────────────────────────────────────────
//
// De powerup-balk moet zichtbaar zijn zolang er gespeeld wordt en verdwijnen
// zodra het toetsenbord opengaat. De verbergstand zelf is CSS
// (.pu-bar--onder-toetsenbord: translateY(calc(100% + var(--kb-inset))) plus
// visibility: hidden) en is nooit weggeweest; wat stukging was de MEETING die
// hem aanzet.
//
// De oude som trok `visualViewport.offsetTop` af. Die verschuiving zet iOS
// Safari zelf om een gefocust veld boven het toetsenbord te krijgen — en juist
// op dit scherm gebeurt dat altijd, want de pagina kan niet scrollen
// (html.mixup-geen-paginascroll). Hoe lager het veld, hoe groter de
// verschuiving, hoe kleiner de uitkomst: onder een veld onderaan de kaart zakte
// de som onder de drempel en kwam de balk terug — precies bovenop het
// toetsenbord.
//
// De tabel hieronder is die situatie, met de toestelmaten van dit project.
//
// ── Waarom dit kan zonder toestel ────────────────────────────────────────────
//
// De som staat als pure functie in src/lib/keyboard-inset.ts. De challenge-
// pagina heeft er geen eigen kopie van maar roept hem aan; de laatste controle
// in dit bestand bewaakt precies dat. Er wordt geen SQL gedraaid en geen
// migratie uitgevoerd; dit bestand leest alleen.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	toetsenbordBedekking,
	toetsenbordOpenBij,
	TOETSENBORD_DREMPEL_PX
} from '../../src/lib/keyboard-inset.ts';

// Toestelmaten uit dit project (iPhone, iOS Safari): window.innerHeight
// rapporteert het GROTE viewport, visualViewport.height volgt de balk en het
// toetsenbord.
const LAYOUT = 754; // window.innerHeight
const BALK_UIT = 714; // visualViewport.height, adresbalk uitgeklapt, geen toetsenbord
const TOETSENBORD = 336; // hoogte van het iOS-toetsenbord met suggestierij

type Uitslag = { ok: boolean; detail: string };
const results: Uitslag[] = [];
function check(naam: string, ok: boolean, detail: string) {
	results.push({ ok, detail: `${naam} — ${detail}` });
}

/** De som zoals hij WAS, alleen hier, om te laten zien wat er misging. */
function oudeSom(innerHeight: number, vvHeight: number, offsetTop: number): number {
	return Math.max(0, innerHeight - vvHeight - offsetTop);
}

// ── De regressie zelf: veld onderaan, toetsenbord open ──────────────────────
//
// Safari verschuift het visuele viewport om het veld in beeld te houden. Drie
// veldposities, hetzelfde toetsenbord.
{
	const vv = LAYOUT - TOETSENBORD; // 418
	const rijen: Array<[string, number]> = [
		['veld bovenin', 0],
		['veld halverwege', 150],
		['veld onderin', 300]
	];
	const regels: string[] = [];
	let alleVerborgen = true;
	let oudeFaalt = false;
	for (const [waar, offsetTop] of rijen) {
		const nu = toetsenbordBedekking({ innerHeight: LAYOUT, viewportHeight: vv });
		const oud = oudeSom(LAYOUT, vv, offsetTop);
		const nuOpen = toetsenbordOpenBij(nu);
		const oudOpen = toetsenbordOpenBij(oud);
		if (!nuOpen) alleVerborgen = false;
		if (!oudOpen) oudeFaalt = true;
		regels.push(
			`${waar} (offsetTop ${offsetTop}): oud ${oud}px → ${oudOpen ? 'verborgen' : 'ZICHTBAAR'} · nu ${nu}px → ${nuOpen ? 'verborgen' : 'ZICHTBAAR'}`
		);
	}
	check(
		'toetsenbord open, ongeacht waar het veld staat',
		alleVerborgen,
		`de balk gaat in alle drie de standen weg | ${regels.join(' | ')}`
	);
	check(
		'de oude som ging hier stuk',
		oudeFaalt,
		'bij een veld onderaan zakte de oude som onder de drempel — dat is de bug die dit bestand vastlegt'
	);
}

// ── De adresbalk mag de balk NIET laten wiebelen ────────────────────────────
{
	const balkUit = toetsenbordBedekking({ innerHeight: LAYOUT, viewportHeight: BALK_UIT });
	const balkIn = toetsenbordBedekking({ innerHeight: LAYOUT, viewportHeight: LAYOUT });
	check(
		'adresbalk telt niet als toetsenbord',
		!toetsenbordOpenBij(balkUit) && !toetsenbordOpenBij(balkIn),
		`uitgeklapt ${balkUit}px, ingeklapt ${balkIn}px — allebei onder de drempel van ${TOETSENBORD_DREMPEL_PX}px, dus de balk blijft staan tijdens het scrollen`
	);
}

// ── De drempel ligt tussen de twee in ───────────────────────────────────────
{
	const netEronder = toetsenbordOpenBij(TOETSENBORD_DREMPEL_PX);
	const netErboven = toetsenbordOpenBij(TOETSENBORD_DREMPEL_PX + 1);
	check(
		'drempel is exclusief',
		!netEronder && netErboven,
		`exact ${TOETSENBORD_DREMPEL_PX}px telt niet als toetsenbord, ${TOETSENBORD_DREMPEL_PX + 1}px wel`
	);
}

// ── Nooit negatief ──────────────────────────────────────────────────────────
{
	const groter = toetsenbordBedekking({ innerHeight: 700, viewportHeight: 754 });
	check(
		'nooit negatief',
		groter === 0,
		`een visueel viewport dat groter meet dan het layout-viewport geeft ${groter}px, geen negatieve schuifafstand`
	);
}

// ── Bewaakt dat de PAGINA deze module echt gebruikt ─────────────────────────
{
	const bron = readFileSync(
		resolve(process.cwd(), 'src/routes/(game)/challenge/[id]/+page.svelte'),
		'utf8'
	);
	const importeert = /from '\$lib\/keyboard-inset'/.test(bron);
	const roeptAan =
		/\btoetsenbordBedekking\s*\(/.test(bron) && /\btoetsenbordOpenBij\s*\(/.test(bron);
	// De handtekening van de fout, niet het woord: `- vv.offsetTop` in de som.
	// Het woord zelf mag in de toelichting blijven staan — daar hoort het juist.
	const geenAftrek = !/-\s*vv\.offsetTop/.test(bron);
	check(
		'de challenge-pagina gebruikt deze module',
		importeert && roeptAan && geenAftrek,
		importeert && roeptAan && geenAftrek
			? 'de pagina meet niet zelf meer, en trekt offsetTop nergens meer af'
			: `import: ${importeert}, aanroepen: ${roeptAan}, aftrek weg: ${geenAftrek}`
	);
}

// ── Bewaakt dat de CSS-verbergstand er nog staat ────────────────────────────
// De meting aanzetten heeft geen zin als de stand die ze aanzet verdwenen is —
// en verdwijnen is precies wat hier onderzocht werd.
{
	const bron = readFileSync(
		resolve(process.cwd(), 'src/routes/(game)/challenge/[id]/+page.svelte'),
		'utf8'
	);
	const heeftKlasse = /\.pu-bar--onder-toetsenbord\s*\{/.test(bron);
	const heeftTransform = /translateY\(calc\(100% \+ var\(--kb-inset[^)]*\)\)\)/.test(bron);
	const heeftVisibility = /\.pu-bar--onder-toetsenbord\s*\{[^}]*visibility:\s*hidden/s.test(bron);
	const gekoppeld = /class:pu-bar--onder-toetsenbord=\{toetsenbordOpen\}/.test(bron);
	check(
		'de verbergstand staat er nog en hangt aan de vlag',
		heeftKlasse && heeftTransform && heeftVisibility && gekoppeld,
		`klasse: ${heeftKlasse}, transform: ${heeftTransform}, visibility: ${heeftVisibility}, gekoppeld aan toetsenbordOpen: ${gekoppeld}`
	);
}

// ── Falsificatie: gaat dit bestand ook echt rood? ───────────────────────────
{
	const zouAltijdOpenZijn = toetsenbordOpenBij(0);
	check(
		'falsificatie',
		!zouAltijdOpenZijn,
		zouAltijdOpenZijn
			? 'een bedekking van 0 telt als toetsenbord — de controles hierboven bewijzen niets'
			: 'een meting die alles als toetsenbord ziet zou hier rood worden; 0px doet dat niet'
	);
}

let failed = 0;
for (const r of results) {
	console.log(`${r.ok ? '✅' : '❌'} ${r.detail}`);
	if (!r.ok) failed++;
}
console.log(failed === 0 ? '\nAlles groen.' : `\n${failed} controle(s) rood.`);
process.exit(failed === 0 ? 0 : 1);
