<script lang="ts">
	/**
	 * LAAGPROBE — meet de achtergrondlaag op het TOESTEL, op de echte pagina.
	 *
	 * Aanzetten met `?probe=laag` achter een willekeurige spelers-URL, bijv.
	 * /team?probe=laag. Uitzetten met `?probe=uit`, of door de tab te sluiten.
	 *
	 * ── Waarom de vlag uit een cookie komt ──────────────────────────────────
	 * De eerste versie keek alleen naar de query-parameter, en dat werkte niet
	 * op de plekken waar het ertoe doet. Bijna elk instappunt van de
	 * spelersflow is een REDIRECT: /join stuurt door naar /team,
	 * /sets/[id]/join naar /play/teams of /play/teams/randomizing. SvelteKit
	 * stuurt daarbij een kale Location mee (`redirect(302, '/team')`), dus de
	 * parameter valt weg vóórdat er clientcode draait. sessionStorage helpt
	 * daar niet tegen, precies omdat de omleiding op de SERVER gebeurt en het
	 * component de parameter nooit te zien krijgt.
	 *
	 * hooks.server.ts zet de vlag daarom in een sessiecookie, op de response
	 * die de redirect zelf draagt. Die overleeft de hele keten. Dit component
	 * leest hem, of de parameter als die er nog staat. Zonder allebei rendert
	 * het niets en meet het niets.
	 *
	 * ── Waarom in de app en niet in de console ──────────────────────────────
	 * iOS Safari heeft geen console zonder een Mac ernaast. De meting moet op
	 * de ECHTE pagina gebeuren — een aparte diagnosepagina heeft precies het
	 * probleem dat de vorige ronde onvindbaar maakte: daar klopte alles wel.
	 * Dus meet dit component ter plekke en zet de uitkomst op het scherm.
	 *
	 * Het herhaalt de meting bij scrollen, draaien en elke viewportwijziging,
	 * zodat je de browserbalk kunt in- en uitklappen en live ziet wat er met
	 * de laag gebeurt.
	 *
	 * DIT COMPONENT LEEST ALLEEN. Het schrijft niets, het verandert geen
	 * layout (position: fixed, eigen laag bovenop) en het toont uitsluitend
	 * viewportmaten en berekende CSS — geen spelers-, team- of setgegevens.
	 */
	import { browser } from '$app/environment';
	import { page } from '$app/stores';

	const CB_PROPS = [
		'transform',
		'translate',
		'rotate',
		'scale',
		'filter',
		'backdropFilter',
		'webkitBackdropFilter',
		'perspective',
		'willChange',
		'contain',
		'containerType'
	] as const;

	const param = $derived($page.url.searchParams.get('probe'));

	/**
	 * Aan als de cookie het zegt (die hooks.server.ts zet, en die de redirects
	 * overleeft), of als de parameter nog in de URL staat. `?probe=uit` zet hem
	 * uit — hooks wist de cookie dan op dezelfde response.
	 *
	 * Alleen client-side: tijdens SSR is er geen document, dus de balk verschijnt
	 * één frame na de hydratie. Voor een diagnosebalk is dat prima.
	 */
	const on = $derived(
		param === 'uit'
			? false
			: param === 'laag' || (browser && document.cookie.includes('mixup_probe=1'))
	);

	let text = $state('meten…');
	let copied = $state(false);

	function px(v: string): number {
		return Math.round(parseFloat(v));
	}

	function meet(): string {
		const b = document.querySelector('.player-screen__backdrop') as HTMLElement | null;

		// Eenheden zoals DEZE engine ze rekent.
		const m = document.createElement('div');
		m.style.cssText = 'position:absolute;top:-9999px;left:0;width:1px;';
		document.body.appendChild(m);
		const unit = (u: string) => {
			m.style.height = `100${u}`;
			return px(getComputedStyle(m).height);
		};
		const svh = unit('svh');
		const lvh = unit('lvh');
		const dvh = unit('dvh');
		const vh = unit('vh');

		// safe-area-insets: alleen leesbaar via een echte berekening.
		const inset = (side: string) => {
			m.style.height = `env(safe-area-inset-${side}, 0px)`;
			return px(getComputedStyle(m).height);
		};
		const insets = `t${inset('top')} r${inset('right')} b${inset('bottom')} l${inset('left')}`;
		m.remove();

		const L: string[] = [];
		// scrollY is sinds de vaste body altijd 0; wat er echt scrolt is
		// .app-scroll. Allebei tonen, zodat een terugval naar vensterscroll
		// meteen zichtbaar is.
		const scroller = document.querySelector('.app-scroll') as HTMLElement | null;
		const scrollTop = scroller ? Math.round(scroller.scrollTop) : -1;

		L.push(`url        ${location.pathname}`);
		L.push(`viewport   ${window.innerWidth}x${window.innerHeight}`);
		L.push(`scroll     venster ${Math.round(scrollY)}   app-scroll ${scrollTop}`);
		L.push(`svh ${svh}   lvh ${lvh}   dvh ${dvh}   vh ${vh}`);
		L.push(`safe-area  ${insets}`);

		if (!b) {
			L.push('');
			L.push('GEEN .player-screen__backdrop op deze pagina.');
			L.push('Open een spelerscherm, bijv. /team?probe=laag');
			return L.join('\n');
		}

		const r = b.getBoundingClientRect();
		const cs = getComputedStyle(b);
		const grond =
			cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 34) + '…' : cs.backgroundColor;

		L.push('');
		L.push(`laag       ${cs.position}  top ${Math.round(r.top)}  bottom ${Math.round(r.bottom)}`);
		L.push(`grond      ${grond}`);

		// Voorouders die van `fixed` stiekem `absolute` maken.
		const risico: string[] = [];
		let node: Element | null = b.parentElement;
		while (node) {
			const ncs = getComputedStyle(node);
			for (const p of CB_PROPS) {
				const v = ncs[p as keyof CSSStyleDeclaration] as string;
				if (v && v !== 'none' && v !== 'auto' && v !== 'normal') {
					const naam =
						node.tagName.toLowerCase() +
						(typeof node.className === 'string' && node.className
							? '.' + node.className.trim().split(/\s+/)[0]
							: '');
					risico.push(`${naam} ${p}:${v.slice(0, 22)}`);
				}
			}
			node = node.parentElement;
		}

		// ── Hoekmeting ───────────────────────────────────────────────────────
		// De laagmeting hierboven zegt waar de LAAG staat; dit zegt waar de vier
		// kristal-hoeken IN die laag terechtkomen. Per hoek: de afstand tot de
		// schermrand waar hij aan hangt, de gerenderde maat, en de natuurlijke
		// maat van het bestand. Vervorming is meteen zichtbaar — als de
		// gerenderde verhouding afwijkt van de natuurlijke, staat er een `!`.
		const hoeken = [...document.querySelectorAll('img.player-screen__corner')] as HTMLImageElement[];
		L.push('');
		if (hoeken.length === 0) {
			L.push('hoeken     geen (corners={false} op dit scherm)');
		} else {
			L.push(`hoeken     ${hoeken.length} stuks   naam  natuurlijk -> gerenderd   inzet`);
			for (const el of hoeken) {
				const r = el.getBoundingClientRect();
				const naam = (el.currentSrc || el.src).split('/').pop()?.replace(/^frame-hoek-|-v2\.webp$/g, '') ?? '?';
				const rw = Math.round(r.width);
				const rh = Math.round(r.height);
				// Verankerd aan links of rechts, boven of onder: toon de kleinste
				// van de twee, dat is de rand waar hij aan hangt.
				const l = Math.round(r.left);
				const rr = Math.round(innerWidth - r.right);
				const t = Math.round(r.top);
				const bo = Math.round(innerHeight - r.bottom);
				const zijkant = l <= rr ? `l${l}` : `r${rr}`;
				const verticaal = t <= bo ? `b${t}` : `o${bo}`;
				// Vervormingscontrole: gerenderde ratio tegen de natuurlijke ratio.
				const nat = el.naturalWidth && el.naturalHeight;
				const scheef =
					nat && Math.abs(rw / rh - el.naturalWidth / el.naturalHeight) > 0.02 ? ' !VERVORMD' : '';
				L.push(
					`  ${naam.padEnd(12)}${el.naturalWidth}x${el.naturalHeight} -> ${rw}x${rh}` +
						`  ${zijkant} ${verticaal}` +
						`  ${((rw / innerWidth) * 100).toFixed(0)}%br ${((rh / innerHeight) * 100).toFixed(0)}%hg${scheef}`
				);
			}
			// Samenvatting: de twee getallen waar het bij "lopen ze door" om gaat.
			const rects = hoeken.map((el) => el.getBoundingClientRect());
			const onder = rects.filter((r) => innerHeight - r.bottom < 4);
			const bandBreedte = onder.reduce((a, r) => a + r.width, 0);
			const schoonMidden =
				Math.min(...rects.filter((r) => r.top > innerHeight / 2).map((r) => r.top)) -
				Math.max(...rects.filter((r) => r.top < innerHeight / 2).map((r) => r.bottom));
			L.push(
				`  onderband  ${Math.round(bandBreedte)}px van ${innerWidth} = ${((bandBreedte / innerWidth) * 100).toFixed(0)}% van de breedte`
			);
			L.push(
				`  schoon midden  ${Math.round(schoonMidden)}px = ${((schoonMidden / innerHeight) * 100).toFixed(0)}% van de hoogte`
			);
		}

		L.push('');
		// De kern van de toestelmeting: schuift de laag mee met de scroll?
		// Een verankerde laag houdt top 0, ongeacht hoe ver er gescrold is.
		L.push(
			`laag blijft staan    ${Math.round(r.top) === 0 ? 'JA' : `NEE  ← top ${Math.round(r.top)} bij scroll ${scrollTop}`}`
		);
		L.push(`bottom==lvh          ${Math.round(r.bottom) === lvh ? 'JA' : 'NEE  ← hier zit het'}`);
		L.push(`grond is gradient    ${cs.backgroundImage !== 'none' ? 'JA' : 'NEE  ← hier zit het'}`);
		L.push(`laag is fixed        ${cs.position === 'fixed' ? 'JA' : 'NEE  ← hier zit het'}`);
		L.push(
			`voorouder knipt      ${risico.length === 0 ? 'NEE (goed)' : 'JA ← ' + risico.join(' | ')}`
		);

		return L.join('\n');
	}

	// $effect en niet onMount: de probe kan binnen dezelfde tab AAN gaan zonder
	// dat dit component opnieuw mount (client-side navigatie naar een URL mét de
	// parameter). De lus hangt daarom aan `on`, niet aan de montage.
	$effect(() => {
		if (!on) return;
		const run = () => {
			text = meet();
		};
		run();
		const t = setInterval(run, 500);
		addEventListener('resize', run);
		addEventListener('scroll', run, { passive: true });
		const scroller = document.querySelector('.app-scroll');
		scroller?.addEventListener('scroll', run, { passive: true });
		addEventListener('orientationchange', run);
		return () => {
			clearInterval(t);
			removeEventListener('resize', run);
			removeEventListener('scroll', run);
			scroller?.removeEventListener('scroll', run);
			removeEventListener('orientationchange', run);
		};
	});

	async function kopieer() {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// Klembord geweigerd (geen https, of gebruiker heeft het uit): dan blijft
			// de tekst gewoon leesbaar op het scherm staan voor een screenshot.
			copied = false;
		}
	}
</script>

{#if on}
	<div class="probe">
		<pre>{text}</pre>
		<button type="button" onclick={kopieer}>{copied ? 'gekopieerd' : 'kopieer'}</button>
	</div>
{/if}

<style>
	.probe {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 2147483647;
		background: rgba(0, 0, 0, 0.88);
		color: #7cff9b;
		border-bottom: 1px solid #7cff9b;
		padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
		padding-top: calc(8px + env(safe-area-inset-top, 0px));
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	pre {
		margin: 0;
		font-size: 10px;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}

	button {
		margin-top: 6px;
		background: #7cff9b;
		color: #000;
		border: 0;
		border-radius: 4px;
		padding: 5px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: 700;
	}
</style>
