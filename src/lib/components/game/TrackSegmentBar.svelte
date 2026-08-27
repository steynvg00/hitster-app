<script lang="ts">
	/**
	 * Segmentbalk van het antwoordformulier (redesign fase 3, scherm 7B).
	 *
	 * Bron: design_handoff_mixup_redesign/design/"M!XUP Player Flow v2.dc.html"
	 * (artboard "7B Antwoordformulier var B", `mkVar('B', …)` + `varBScroll`) en
	 * de regels in het masterdocument:
	 *
	 *   · tabrij totaal 34px hoog — geen dikke blokken
	 *   · tabs min-width 96px, `overflow-x:auto` — werkt bij MEER dan 3 tracks
	 *   · per tab: indicator-bolletje + tracknummer in één box
	 *   · twijfel = 26px squircle-symboolknop naast het tracknummer
	 *   · actieve twijfel: gevulde amber knop met donkere glyph
	 *   · de actieve tab neemt de teamkleur over
	 *
	 * PUUR PRESENTATIE. Deze component bezit geen state: de actieve tab, de
	 * vulstatus en de twijfelvlaggen komen van de challenge-pagina, en elke tik
	 * gaat via `onselect` / `ontoggledoubt` terug naar dezelfde `goToTab()` /
	 * `toggleDoubt()` die er al waren.
	 *
	 * Twee knoppen per segment, geen geneste knop
	 * ────────────────────────────────────────────
	 * In de designbron zit de twijfel-`?` als span mét onClick BINNEN de
	 * tab-button. Een knop in een knop is ongeldige HTML (en onbereikbaar met
	 * toetsenbord/screenreader), dus het segment is hier de visuele box en de
	 * twee knoppen zijn siblings erbinnen. Met `justify-content:center` en
	 * gap 12 staat de groep [bolletje · nummer · ?] precies zoals in het design —
	 * bij min-width 96px vult die groep de box exact.
	 *
	 * Hit targets
	 * ───────────
	 * De rij is een designwaarde van 34px, dus 44px hoog kan hier niet. Wat wel
	 * kan is de tap-zone in de breedte: de tab-knop vult de volle 34px hoogte en
	 * minstens ~70px breed, en de twijfel-knop is visueel 26px met een 34x34
	 * tap-zone via een ::after (verticaal binnen de rij, horizontaal 4px extra
	 * per zijde). Verticaal uitbreiden kán niet: `overflow-x:auto` dwingt
	 * `overflow-y` ook naar auto, dus alles wat boven of onder de rij uitsteekt
	 * zou geklipt worden en een verticale scrollbar opleveren.
	 */
	type FillStatus = 'empty' | 'partial' | 'full';

	type Props = {
		/** Aantal segmenten (= aantal tabs/tracks). Variabel — 2 t/m n. */
		count: number;
		activeIndex: number;
		/** Vulstatus per index, bepaalt het indicator-bolletje. */
		fillStatus: FillStatus[];
		/** Twijfelvlag per index (session-only op de pagina). */
		doubt: Record<number, boolean>;
		/** Teamkleur — de actieve tab neemt die over. */
		hex: string;
		/** Leesbare tekstkleur op de teamkleur. */
		onColor: string;
		/** Label per segment; standaard het tracknummer (index + 1). */
		labels?: string[];
		/**
		 * Hoe één segment heet in voorleestekst en tooltips: "Track" of "Beurt".
		 *
		 * Deze balk selecteert een TAB. Bij de meeste varianten valt een tab samen
		 * met één track, en dan is "Track" ook de eerlijke naam. Bij mashup en
		 * fragments niet: daar zitten er meerdere bron-tracks IN één tab, en die
		 * kies je met de knoppenrij bij het antwoordveld. Dan heet een segment hier
		 * een beurt, zodat de twee kiezers niet allebei "Track" heten.
		 *
		 * Standaard "Track", dus voor elke andere variant verandert er niets.
		 */
		unit?: string;
		onselect: (i: number) => void;
		ontoggledoubt: (i: number) => void;
	};

	let {
		count,
		activeIndex,
		fillStatus,
		doubt,
		hex,
		onColor,
		labels,
		unit = 'Track',
		onselect,
		ontoggledoubt
	}: Props = $props();

	const indices = $derived(Array.from({ length: count }, (_, i) => i));
	const labelFor = (i: number) => labels?.[i] ?? String(i + 1);

	// De actieve tab in beeld scrollen. Bij >3 tracks staat de actieve tab na
	// een Volgende-tik anders buiten de zichtbare rij — dat is precies het
	// geval waarvoor deze balk horizontaal scrollt.
	let itemEls: (HTMLDivElement | undefined)[] = $state([]);
	$effect(() => {
		const el = itemEls[activeIndex];
		el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
	});

	function dotClass(status: FillStatus): string {
		if (status === 'full') return 'seg-dot seg-dot--full';
		if (status === 'partial') return 'seg-dot seg-dot--partial';
		return 'seg-dot seg-dot--empty';
	}

	function statusLabel(status: FillStatus): string {
		if (status === 'full') return 'alles ingevuld';
		if (status === 'partial') return 'deels ingevuld';
		return 'nog niets ingevuld';
	}
</script>

<div class="seg-row squircle" role="tablist" aria-label="Kies een {unit.toLowerCase()}">
	{#each indices as i (i)}
		{@const status = fillStatus[i] ?? 'empty'}
		{@const active = activeIndex === i}
		{@const unsure = !!doubt[i]}
		<div
			class="seg-item"
			bind:this={itemEls[i]}
			style="background: {active ? hex : 'transparent'}; color: {active ? onColor : '#8E9BC9'};"
		>
			<button
				type="button"
				role="tab"
				aria-selected={active}
				class="seg-tab"
				onclick={() => onselect(i)}
			>
				<span class={dotClass(status)} aria-hidden="true"></span>
				<span>{labelFor(i)}</span>
				<span class="sr-only">
					{unit}
					{labelFor(i)} — {statusLabel(status)}{unsure ? ', gemarkeerd als twijfel' : ''}
				</span>
			</button>
			<button
				type="button"
				class="seg-doubt squircle"
				aria-pressed={unsure}
				title={unsure
					? `${unit} ${labelFor(i)}: twijfel — tik om te wissen`
					: `${unit} ${labelFor(i)} als twijfel markeren`}
				onclick={() => ontoggledoubt(i)}
				style="color: {unsure ? '#1A1400' : active ? onColor : '#5A648C'};"
			>
				<span aria-hidden="true">?</span>
				<span class="sr-only"
					>{unsure ? 'Twijfel aan' : 'Twijfel uit'} voor track {labelFor(i)}</span
				>
			</button>
		</div>
	{/each}
</div>

<style>
	/* varBScroll.rowStyle */
	.seg-row {
		display: flex;
		overflow-x: auto;
		border-radius: 14px;
		border: 1px solid rgba(229, 242, 255, 0.16);
		background: rgba(11, 11, 31, 0.5);
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
	}
	.seg-row::-webkit-scrollbar {
		display: none;
	}

	/* mkVar('B').itemStyle + boxStyle samengevoegd: het segment IS de box. */
	.seg-item {
		flex: 0 0 auto;
		min-width: 96px;
		height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 0 12px;
		box-sizing: border-box;
		border-right: 1px solid rgba(229, 242, 255, 0.1);
		transition: background-color 0.18s ease;
	}
	.seg-item:last-child {
		border-right: none;
	}

	.seg-tab {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 100%;
		min-width: 44px;
		padding: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		color: inherit;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 19px;
		line-height: 1;
	}

	/* mkVar('B').qStyle — 26px squircle (masterdocument), amber bij twijfel. */
	.seg-doubt {
		position: relative;
		width: 26px;
		height: 26px;
		flex: 0 0 auto;
		border-radius: 9px;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		box-sizing: border-box;
		cursor: pointer;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 12px;
		background: rgba(11, 11, 31, 0.5);
		border: 1px solid rgba(229, 242, 255, 0.22);
		transition:
			background-color 0.18s ease,
			border-color 0.18s ease;
	}
	.seg-doubt[aria-pressed='true'] {
		background: var(--color-mixup-amber);
		border-color: var(--color-mixup-amber);
	}
	/* Tap-zone: visueel 26px, aanraakbaar 34x34 — de volle rijhoogte plus 4px
	   per zijde. Verder oprekken kan niet, zie de kop van dit bestand. */
	.seg-doubt::after {
		content: '';
		position: absolute;
		top: -4px;
		bottom: -4px;
		left: -4px;
		right: -4px;
	}

	/* dotFor(): vol = cyaan bol met glow, deels = amber halve ruit,
	   leeg = open cirkel. Kleur ÉN vorm verschillen, dus de drie zijn ook
	   zonder kleurwaarneming uit elkaar te houden. */
	.seg-dot {
		width: 10px;
		height: 10px;
		flex: 0 0 auto;
		display: inline-block;
		box-sizing: border-box;
	}
	.seg-dot--full {
		border-radius: 50%;
		background: var(--color-mixup-cyan);
		box-shadow: 0 0 8px var(--color-mixup-cyan);
	}
	.seg-dot--partial {
		border-radius: 3px;
		transform: rotate(45deg);
		background: linear-gradient(90deg, #ffe600 50%, transparent 50%);
		border: 1.5px solid var(--color-mixup-yellow);
	}
	.seg-dot--empty {
		border-radius: 50%;
		border: 1.5px solid var(--color-mixup-muted);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}
</style>
