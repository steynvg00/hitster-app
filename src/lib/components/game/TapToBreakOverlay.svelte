<script lang="ts">
	// Stuk 3 (FINAL) offensive powerup: full-screen blocking lock. Tap counting is
	// CLIENT-LOCAL — no per-tap round-trips — only the 20th tap posts to
	// /api/effects/consume (the ownership-gated endpoint stuk 1 built for
	// give_a_shot's "Drunk!" ack, reused here to mark the row consumed). This
	// overlay physically covers the form (fixed + full-screen, same technique as
	// the freeze overlay) — that's the whole submit-block; there's no server-side
	// submit rejection by design.
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

	// Fixed crack-line geometry (angle/length/position) — deterministic, no
	// randomness, so the shatter pattern is identical every time but still reads
	// as organic cracked glass. Crack i fades in as progress crosses i/N..(i+1)/N.
	const CRACKS = [
		{ rotate: 12, length: 62, top: '22%', left: '12%' },
		{ rotate: -28, length: 50, top: '58%', left: '18%' },
		{ rotate: 46, length: 55, top: '28%', left: '52%' },
		{ rotate: -55, length: 58, top: '64%', left: '55%' },
		{ rotate: 6, length: 40, top: '12%', left: '42%' },
		{ rotate: -12, length: 46, top: '76%', left: '30%' }
	];

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

<div
	class="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-slate-950/85 backdrop-blur-md"
	role="dialog"
	aria-modal="true"
>
	<span class="text-5xl">🔒</span>
	<p class="text-lg font-black text-white">Locked by {sourceName}!</p>
	<p class="text-sm text-zinc-400">Tap to break free</p>

	<button
		type="button"
		onclick={tap}
		disabled={breaking}
		class="relative flex h-40 w-40 items-center justify-center overflow-hidden rounded-full border-4 border-slate-500 bg-slate-800 text-6xl transition-transform active:scale-95 {punch
			? 'scale-105'
			: ''}"
	>
		🔨
		{#each CRACKS as c, i (i)}
			<div
				class="absolute h-0.5 rounded-full bg-white transition-opacity duration-150"
				style="width: {c.length}%; top: {c.top}; left: {c.left}; transform: rotate({c.rotate}deg); opacity: {Math.max(
					0,
					Math.min(1, progress * CRACKS.length - i)
				)};"
			></div>
		{/each}
	</button>

	<p class="font-mono text-2xl font-black text-white tabular-nums">{taps} / {tapsRequired}</p>
	<div class="h-2 w-48 overflow-hidden rounded-full bg-slate-700">
		<div
			class="h-full bg-amber-400 transition-all duration-150"
			style="width: {progress * 100}%;"
		></div>
	</div>
</div>
