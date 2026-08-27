<script lang="ts">
	/**
	 * LAAGPROBE — meet de achtergrondlaag op het TOESTEL, op de echte pagina.
	 *
	 * Aanzetten met `?probe=laag` achter een willekeurige spelers-URL, bijv.
	 * /team?probe=laag. Staat die parameter er niet, dan rendert dit component
	 * niets en meet het niets.
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
	import { onMount } from 'svelte';
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

	const on = $derived($page.url.searchParams.get('probe') === 'laag');

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
		L.push(`url        ${location.pathname}`);
		L.push(`viewport   ${window.innerWidth}x${window.innerHeight}  scrollY ${Math.round(scrollY)}`);
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

		L.push('');
		L.push(`bottom==lvh          ${Math.round(r.bottom) === lvh ? 'JA' : 'NEE  ← hier zit het'}`);
		L.push(`grond is gradient    ${cs.backgroundImage !== 'none' ? 'JA' : 'NEE  ← hier zit het'}`);
		L.push(`laag is fixed        ${cs.position === 'fixed' ? 'JA' : 'NEE  ← hier zit het'}`);
		L.push(
			`voorouder knipt      ${risico.length === 0 ? 'NEE (goed)' : 'JA ← ' + risico.join(' | ')}`
		);

		return L.join('\n');
	}

	onMount(() => {
		if (!on) return;
		const run = () => {
			text = meet();
		};
		run();
		const t = setInterval(run, 500);
		addEventListener('resize', run);
		addEventListener('scroll', run, { passive: true });
		addEventListener('orientationchange', run);
		return () => {
			clearInterval(t);
			removeEventListener('resize', run);
			removeEventListener('scroll', run);
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
