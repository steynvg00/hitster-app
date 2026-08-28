// GEDRAGSCONTROLE voor de bovenzone van scherm 7B (het antwoordformulier).
//
//   npm run bots:verify-top-zone
//
// ── Waarom dit bestand bestaat ───────────────────────────────────────────────
//
// Dit was de vierde poging op deze zone. De eerste drie faalden niet omdat de
// oplossing fout was, maar omdat er telkens het VERKEERDE ding gemeten werd: de
// positie van de teampil. Die stond na poging drie al goed — exact op de
// safe-area-inset, dus op de onderrand van de dynamic island.
//
// Wat er zichtbaar bleef was de BAND. `.top-zone` is de enige doos in de keten
// met een eigen achtergrond, en die begon op dezelfde hoogte als de pil.
// Daarboven stond de paginagradient: op een toestel een naad op de onderrand van
// de island, op een schermafdruk zonder island een lichte strook bovenaan.
//
// Deze controle meet daarom BEIDE: waar de inhoud begint én waar de band begint.
// Een volgende poging die de pil verschuift maar de band laat staan, gaat hier
// rood.
//
// ── Hoe er gemeten wordt ─────────────────────────────────────────────────────
//
// Niet met een overgetypte kopie van de regels — dat is precies hoe een meting
// iets anders gaat beschrijven dan wat er draait. De <style>-blokken worden
// LETTERLIJK uit PlayerScreen.svelte en challenge/[id]/+page.svelte gelezen en
// in WebKit gezet, in de DOM-structuur die die twee bestanden opbouwen.
//
// `env(safe-area-inset-top)` levert in een headless browser altijd 0 op, dus hij
// wordt vervangen door een variabele die op de toestelwaarde gezet wordt. Dat is
// de enige afwijking van de echte pagina, en hij staat aan beide kanten van de
// vergelijking.
//
// Er wordt geen SQL gedraaid en geen migratie uitgevoerd; dit bestand leest
// alleen bestanden en rekent in een browser.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webkit } from 'playwright';

const PLAYER_SCREEN = 'src/lib/components/game/PlayerScreen.svelte';
const CHALLENGE_PAGE = 'src/routes/(game)/challenge/[id]/+page.svelte';

/** Het <style>-blok uit een .svelte-bestand, letterlijk. */
function styleBlok(pad: string): string {
	const bron = readFileSync(resolve(process.cwd(), pad), 'utf8');
	const m = bron.match(/<style>([\s\S]*)<\/style>/);
	if (!m) throw new Error(`geen <style>-blok in ${pad}`);
	return m[1];
}

/** env() bestaat niet headless; de inset wordt een variabele die we opleggen. */
function metVariabeleInset(css: string): string {
	return css
		.replace(/env\(safe-area-inset-top,\s*0px\)/g, 'var(--sat)')
		.replace(/env\(safe-area-inset-top\)/g, 'var(--sat)')
		.replace(/env\(safe-area-inset-bottom,\s*0px\)/g, '0px')
		.replace(/env\(safe-area-inset-left,\s*0px\)/g, '0px')
		.replace(/env\(safe-area-inset-right,\s*0px\)/g, '0px');
}

const PLAYER_CSS = metVariabeleInset(styleBlok(PLAYER_SCREEN));
const CHALLENGE_CSS = metVariabeleInset(styleBlok(CHALLENGE_PAGE));

/**
 * De DOM van scherm 7B zoals +page.svelte hem opbouwt. Alleen de dozen die
 * tussen de bovenkant van het document en de teampil staan; de rest van het
 * scherm doet aan deze meting niet mee.
 */
const HTML = (sat: number) => `<!doctype html><html><head><style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { min-height: 100dvh; }
  :root { --sat: ${sat}px; }
  ${PLAYER_CSS}
  ${CHALLENGE_CSS}
  /* De Tailwind-utilities die in deze zone daadwerkelijk meedoen: px-5 op de
     pilrij, en de pil zelf. Geen van beide heeft een verticale marge. */
  .pil-rij { display: flex; align-items: center; justify-content: space-between;
             padding-left: 20px; padding-right: 20px; }
  .pil { display: inline-flex; align-items: center; gap: 7px; border-radius: 9999px;
         padding: 6px 12px; font: 700 11px system-ui; background: rgba(255,255,255,.08); }
</style></head><body>
<div class="player-screen player-screen--fit player-screen--flush-top">
  <div class="player-screen__backdrop"></div>
  <div class="player-screen__body answer-screen">
    <div class="top-zone">
      <div class="pil-rij"><span class="pil" id="pil">TEAM BLAUW</span><span class="pil">12:00</span></div>
    </div>
    <div class="scroll-zone">inhoud</div>
  </div>
</div>
</body></html>`;

// Als string, niet als functie: tsx draait met keepNames en injecteert dan een
// __name-hulpje dat in de paginacontext niet bestaat.
const METING = `(() => {
  const lees = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      top: r.top,
      padTop: parseFloat(cs.paddingTop) || 0,
      marTop: parseFloat(cs.marginTop) || 0,
      borTop: parseFloat(cs.borderTopWidth) || 0
    };
  };
  return {
    scherm: lees('.player-screen'),
    achtergrond: lees('.player-screen__backdrop'),
    body: lees('.player-screen__body'),
    band: lees('.top-zone'),
    rij: lees('.pil-rij'),
    pil: lees('#pil')
  };
})()`;

type Vak = { top: number; padTop: number; marTop: number; borTop: number };
type Meting = Record<'scherm' | 'achtergrond' | 'body' | 'band' | 'rij' | 'pil', Vak>;

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass
			? JSON.stringify(got)
			: `kreeg ${JSON.stringify(got)}, verwacht ${JSON.stringify(want)}`
	});
	console.log(`  ${pass ? '✓' : '✗'} ${name}  ${checks[checks.length - 1].detail}`);
}
function assertTrue(name: string, cond: boolean, detail: string) {
	checks.push({ name, pass: cond, detail });
	console.log(`  ${cond ? '✓' : '✗'} ${name}  ${detail}`);
}

async function main() {
	// De twee standen die ertoe doen: een toestel met dynamic island, en elke
	// omgeving zonder safe-area (desktop, Android zonder notch, en de
	// screenshot-harness van scripts/sim-spelersflow.ts — die draait WebKit op
	// 390x844 zonder safe-area-emulatie).
	const STANDEN: Array<[string, number, number]> = [
		['geen inset (schermafdruk / desktop)', 0, 8],
		['dynamic island', 59, 59],
		['notch', 47, 47]
	];

	const browser = await webkit.launch();
	try {
		for (const [naam, sat, verwachteInhoud] of STANDEN) {
			console.log(`\n── ${naam} · env(safe-area-inset-top) = ${sat}px ──`);
			const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
			await page.setContent(HTML(sat));
			const m = (await page.evaluate(METING)) as Meting;
			await page.close();

			// DE KERN: de band loopt tot de bovenrand door, de inhoud niet.
			assert('de band begint op de bovenrand van het document', m.band.top, 0);
			assert('de teampil begint op de safe-area-inset', m.pil.top, verwachteInhoud);
			assertTrue(
				'geen zichtbare strook boven de band',
				m.band.top === 0,
				`band y=${m.band.top}, pil y=${m.pil.top} — de ruimte ertussen is padding BINNEN de band, dus meegekleurd`
			);

			// De achtergrondlaag en het document beginnen op dezelfde hoogte, dus de
			// twee gevraagde afstanden zijn hier per constructie gelijk. Wordt dat
			// ooit anders, dan is dat een verschuiving die iemand moet zien.
			assert('achtergrondlaag begint op de bovenrand', m.achtergrond.top, 0);
			assert(
				'document-top en achtergrond-top geven dezelfde afstand tot de pil',
				m.pil.top - m.achtergrond.top,
				m.pil.top
			);

			// Geen enkele doos ertussen mag zelf ruimte toevoegen: de hele afstand
			// hoort uit één padding te komen, en niet uit een optelsom. Dat was de
			// fout in de oorspronkelijke stand (56px designmarge + inset + 14px).
			for (const [naamDoos, doos] of [
				['.player-screen', m.scherm],
				['.player-screen__body', m.body],
				['.pil-rij', m.rij]
			] as const) {
				assertTrue(
					`${naamDoos} voegt zelf geen ruimte toe`,
					doos.padTop === 0 && doos.marTop === 0 && doos.borTop === 0,
					`padding ${doos.padTop}, margin ${doos.marTop}, border ${doos.borTop}`
				);
			}
			assert('alle ruimte komt uit de padding van de band', m.band.padTop, verwachteInhoud);
		}
	} finally {
		await browser.close();
	}

	// ── De inset zit precies één keer in de keten ───────────────────────────
	//
	// De oorspronkelijke fout was een optelsom van drie termen die alle drie
	// "ruimte boven" betekenden. Deze controle leest de BRON in plaats van de
	// uitkomst, zodat een tweede inzet die op een testtoestel toevallig 0
	// oplevert hier alsnog opvalt.
	//
	// Alleen de declaraties tellen, niet het commentaar eromheen — en alleen de
	// twee regels die op dit scherm gelden. De 56px-marge op `.player-screen`
	// zelf blijft bestaan voor élk ander spelerscherm en hoort hier niet mee te
	// tellen; `flushTop` zet hem op dit scherm juist uit.
	{
		const blokVan = (css: string, selector: string) => {
			const start = css.indexOf(selector + ' {');
			if (start < 0) return null;
			return css.slice(start, css.indexOf('}', start));
		};
		const declaraties = (blok: string | null) =>
			(blok ?? '')
				.split('\n')
				.map((r) => r.trim())
				.filter((r) => r.includes(':') && r.endsWith(';') && !r.startsWith('*'));

		const flushBlok = blokVan(PLAYER_CSS, '.player-screen--flush-top');
		const zoneBlok = blokVan(CHALLENGE_CSS, '.top-zone');
		const flushZetNul = declaraties(flushBlok).some((r) => /padding-top:\s*0;/.test(r));
		const zoneInzetten = declaraties(zoneBlok).filter((r) => r.includes('var(--sat)'));

		assertTrue(
			'de safe-area-inset staat precies één keer in de keten',
			flushZetNul && zoneInzetten.length === 1,
			flushZetNul && zoneInzetten.length === 1
				? '.player-screen--flush-top zet padding-top op 0, en .top-zone draagt de enige inzet'
				: `flushTop zet nul: ${flushZetNul}, inzetten in .top-zone: ${zoneInzetten.length}`
		);
	}

	// ── Falsificatie ────────────────────────────────────────────────────────
	// Gaat deze meting ook echt rood? Zonder deze controle zou een tabel die
	// altijd groen is er even overtuigend uitzien.
	{
		const browser2 = await webkit.launch();
		const page = await browser2.newPage({ viewport: { width: 390, height: 844 } });
		await page.setContent(
			HTML(59).replace(
				'</style>',
				'.player-screen--flush-top { padding-top: 59px; } .top-zone { padding-top: 0; }</style>'
			)
		);
		const m = (await page.evaluate(METING)) as Meting;
		await browser2.close();
		assertTrue(
			'de oude stand zou hier rood worden',
			m.band.top === 59,
			`met de padding terug op het scherm begint de band op y=${m.band.top} in plaats van 0 — precies de strook die dit bestand bewaakt`
		);
	}

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) process.exit(1);
}

void main();
