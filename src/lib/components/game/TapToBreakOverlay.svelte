<script lang="ts">
	/**
	 * Scherm 7 — TAP-TO-BREAK. De achtergrond breekt progressief per tik: vijf
	 * glasscherven schuiven uit elkaar, tien barsten lichten één voor één op en
	 * de flits achter het glas wordt feller. De voortgang is af te lezen aan de
	 * balk én aan de vijf snapshot-bolletjes uit de designbron.
	 *
	 * PUUR PRESENTATIE. Onveranderd gebleven:
	 *  - het tellen is CLIENT-LOKAAL, geen round-trip per tik;
	 *  - alleen de laatste tik post naar /api/effects/consume met exact dezelfde
	 *    body ({ effect_id }), en pas daarna vuurt `onbreak()`;
	 *  - deze overlay dekt het formulier fysiek af (fixed + volledig scherm) —
	 *    dat IS de submit-blokkade, er is geen server-side afwijzing.
	 *
	 * Designbron: M!XUP Powerup-Laag.dc.html, artboard "7 Tap-to-Break".
	 */
	let {
		effectId,
		sourceName,
		tapsRequired = 20,
		onbreak
	}: {
		effectId: string;
		sourceName: string;
		tapsRequired?: number;
		onbreak: () => void;
	} = $props();

	let taps = $state(0);
	let breaking = $state(false);
	let punch = $state(false);
	let punchTimer: ReturnType<typeof setTimeout> | undefined;

	const progress = $derived(Math.min(1, taps / tapsRequired));
	const done = $derived(taps >= tapsRequired);

	// Vijf scherven over het hele scherm. `cp` is de clip-path, `dx`/`dy`/`r`
	// bepalen hoe ver en hoe scheef die scherf wegschuift bij volledige
	// voortgang. Vaste geometrie — geen randomness, dus het breekpatroon is elke
	// keer hetzelfde.
	const SHARDS = [
		{ cp: 'polygon(0 0,52% 0,44% 38%,0 46%)', dx: -1, dy: -1, r: -1.3 },
		{ cp: 'polygon(52% 0,100% 0,100% 40%,44% 38%)', dx: 1, dy: -1.1, r: 1.2 },
		{ cp: 'polygon(0 46%,44% 38%,52% 72%,0 100%)', dx: -1.3, dy: 1, r: -0.9 },
		{ cp: 'polygon(44% 38%,100% 40%,100% 100%,52% 72%)', dx: 1.2, dy: 1.1, r: 1 },
		{ cp: 'polygon(0 100%,52% 72%,100% 100%)', dx: 0, dy: 1.5, r: 0 }
	];

	// Barsten over de achtergrond: [left%, top%, lengte px, hoek deg]. Elke barst
	// verschijnt op zijn eigen fractie van de voortgang.
	const BG_CRACKS = [
		[8, 16, 130, 24],
		[56, 9, 150, 70],
		[28, 42, 180, -14],
		[5, 60, 140, 34],
		[50, 56, 165, -42],
		[18, 78, 125, 12],
		[62, 72, 135, 58],
		[36, 25, 110, -68],
		[70, 34, 120, 26],
		[12, 35, 95, -32]
	];

	// Barstlijnen op de knop zelf.
	const BTN_CRACKS = [15, 72, 130, 200, 255, 310];

	// De vijf "snapshots" uit de designbron: elke vijfde van de voortgang is er
	// één. Afgeleid van de VOORTGANG, niet van een vast aantal tikken, zodat een
	// andere `tapsRequired` gewoon meeschaalt.
	const stage = $derived(taps === 0 ? 0 : Math.min(5, Math.ceil(progress * 5)));

	async function finishBreak() {
		breaking = true;
		try {
			await fetch('/api/effects/consume', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ effect_id: effectId })
			});
		} finally {
			onbreak();
		}
	}

	function tap() {
		if (breaking || taps >= tapsRequired) return;
		taps += 1;
		punch = true;
		if (punchTimer) clearTimeout(punchTimer);
		punchTimer = setTimeout(() => (punch = false), 100);
		if (taps >= tapsRequired) finishBreak();
	}
</script>

<div class="lock" role="dialog" aria-modal="true" aria-label="Vergrendeld">
	<!-- De brekende achtergrond. -->
	<div class="bg">
		{#each SHARDS as s, i (i)}
			<div
				class="shard"
				style="clip-path: {s.cp}; background: radial-gradient(120% 90% at 50% 40%, rgba(124,77,255,{(
					0.3 -
					progress * 0.16
				).toFixed(3)}) 0%, #0B0B1F 70%); transform: translate({(s.dx * progress * 16).toFixed(
					1
				)}px, {(s.dy * progress * 16).toFixed(1)}px) rotate({(s.r * progress).toFixed(
					2
				)}deg); box-shadow: {taps > 0
					? `0 0 0 1px rgba(229,242,255,${(0.08 + progress * 0.32).toFixed(2)}), 0 0 22px rgba(0,229,255,${(progress * 0.28).toFixed(2)})`
					: 'none'};"
			></div>
		{/each}
		{#each BG_CRACKS as c, i (i)}
			<span
				class="bg-crack"
				style="left: {c[0]}%; top: {c[1]}%; width: {c[2]}px; transform: rotate({c[3]}deg); opacity: {progress *
					BG_CRACKS.length >=
				i + 1
					? 1
					: 0};"
			></span>
		{/each}
		<div
			class="flash"
			style="background: radial-gradient(60% 45% at 50% 45%, rgba(255,255,255,{(
				progress * 0.1
			).toFixed(2)}) 0%, transparent 70%);"
		></div>
	</div>

	<div class="lock-body">
		<div class="lock-title">{done ? 'Gebroken!' : 'Vergrendeld!'}</div>
		<p class="lock-sub">
			{done
				? 'Je scherm is weer vrij.'
				: `${sourceName} heeft je scherm vergrendeld. Tik het glas kapot.`}
		</p>

		<button
			type="button"
			onclick={tap}
			disabled={breaking}
			class="hammer"
			class:hammer--done={done}
			class:hammer--punch={punch}
			aria-label={done ? 'Gebroken' : `Nog ${tapsRequired - taps} tikken`}
		>
			{#each BTN_CRACKS as ang, i (i)}
				<span
					class="btn-crack"
					style="transform: rotate({ang}deg) translateX(12px); background: {progress *
						BTN_CRACKS.length >=
					i + 1
						? 'rgba(229,242,255,0.7)'
						: 'transparent'};"
				></span>
			{/each}
			<span class="hammer-count tabular-nums">{done ? '✓' : tapsRequired - taps}</span>
		</button>

		<div class="bar"><div class="bar-fill" style="width: {progress * 100}%;"></div></div>

		<div class="snap">
			<span class="snap-label">SNAPSHOT {stage}/5</span>
			<span class="snap-dots">
				{#each [1, 2, 3, 4, 5] as i (i)}
					<span class="snap-dot" class:snap-dot--on={i <= stage}></span>
				{/each}
			</span>
		</div>
	</div>
</div>

<style>
	.lock {
		position: fixed;
		inset: 0;
		z-index: 40;
		overflow: hidden;
		/* Designbron: bijna zwart, zodat de scherven eruit springen. */
		background: #04040a;
	}

	.bg {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.shard {
		position: absolute;
		inset: 0;
		transition:
			transform 0.14s ease,
			box-shadow 0.14s ease,
			background 0.14s ease;
	}

	.bg-crack {
		position: absolute;
		height: 2px;
		transform-origin: 0 50%;
		background: linear-gradient(90deg, rgba(229, 242, 255, 0.85), rgba(0, 229, 255, 0.1));
		box-shadow: 0 0 10px rgba(0, 229, 255, 0.55);
		transition: opacity 0.14s ease;
	}

	.flash {
		position: absolute;
		inset: 0;
		transition: background 0.14s;
	}

	.lock-body {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		padding: 0 30px;
		text-align: center;
	}

	.lock-title {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 44px;
		line-height: 0.95;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 26px rgba(124, 77, 255, 0.9);
	}

	.lock-sub {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 14px;
		color: var(--color-mixup-muted);
		max-width: 300px;
	}

	.hammer {
		position: relative;
		width: 160px;
		height: 160px;
		border-radius: 50%;
		overflow: hidden;
		border: 3px solid rgba(229, 242, 255, 0.5);
		background: radial-gradient(circle, #7c4dff 0%, #2a1660 100%);
		box-shadow: 0 0 40px rgba(124, 77, 255, 0.6);
		transition:
			transform 0.1s ease,
			background 0.2s ease,
			box-shadow 0.2s ease;
	}

	.hammer--punch {
		transform: scale(1.05);
	}

	.hammer--done {
		background: radial-gradient(circle, #2bd97a 0%, #0e4d2b 100%);
		box-shadow: 0 0 50px rgba(43, 217, 122, 0.6);
	}

	.btn-crack {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 70px;
		height: 2px;
		transform-origin: 0 50%;
		transition: background 0.15s;
	}

	.hammer-count {
		position: relative;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 64px;
		color: #ffffff;
	}

	.bar {
		width: 100%;
		max-width: 300px;
		height: 8px;
		border-radius: 99px;
		background: rgba(229, 242, 255, 0.1);
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		border-radius: 99px;
		background: linear-gradient(90deg, #7c4dff, #00e5ff);
		transition: width 0.12s;
	}

	.snap {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.snap-label {
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.16em;
		color: var(--color-mixup-dim);
	}

	.snap-dots {
		display: flex;
		gap: 5px;
	}

	.snap-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 99px;
		background: rgba(229, 242, 255, 0.2);
		transition: width 0.2s;
	}

	.snap-dot--on {
		width: 16px;
		background: var(--color-mixup-cyan);
	}

	@media (prefers-reduced-motion: reduce) {
		.shard,
		.hammer,
		.bar-fill {
			transition: none;
		}
	}
</style>
