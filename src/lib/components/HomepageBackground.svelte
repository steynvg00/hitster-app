<script lang="ts">
	import { onMount } from 'svelte';

	// Team palette: blue, yellow, green, red, indigo, slate
	const C = ['#3b82f6', '#eab308', '#22c55e', '#ef4444', '#6366f1', '#64748b'];

	// 0 = stripes NE, 1 = stripes NW, 2 = pulse, 3 = lava, 4 = disco, 5 = bokeh
	let variant = $state(-1);

	type BlobDef = { left: number; top: number; size: number; color: string; dur: number; dx1: number; dy1: number; dx2: number; dy2: number };
	type BokehDef = { left: number; size: number; color: string; blur: number; delay: number; dur: number; opacity: number };

	let blobs: BlobDef[] = $state([]);
	let bokeh: BokehDef[] = $state([]);
	let canvas: HTMLCanvasElement | null = $state(null);
	let rafId = 0;

	onMount(() => {
		variant = Math.floor(Math.random() * 6);

		if (variant === 3) {
			blobs = Array.from({ length: 5 }, (_, i) => {
				const dx = 6 + Math.random() * 10;
				const dy = 5 + Math.random() * 8;
				return {
					left: 5 + i * 19 + Math.random() * 8,
					top: 10 + Math.random() * 65,
					size: 300 + Math.random() * 200,
					color: C[i],
					dur: 14 + i * 3,
					dx1: dx, dy1: dy,
					dx2: dx * 0.6, dy2: dy * 0.7
				};
			});
		} else if (variant === 5) {
			bokeh = Array.from({ length: 20 }, (_, i) => ({
				left: Math.random() * 100,
				size: 70 + Math.random() * 90,
				color: C[i % 6],
				blur: 25 + Math.random() * 35,
				delay: -(Math.random() * 30),
				dur: 18 + Math.random() * 18,
				opacity: 0.2 + Math.random() * 0.35
			}));
		}

		return () => { if (rafId) cancelAnimationFrame(rafId); };
	});

	// Disco ball — start rAF once canvas element is bound
	$effect(() => {
		if (variant !== 4 || !canvas) return;

		const W = window.innerWidth;
		const H = window.innerHeight;
		canvas.width = W;
		canvas.height = H;

		type Ball = { x: number; y: number; vx: number; vy: number; r: number; color: string };
		const balls: Ball[] = Array.from({ length: 40 }, () => ({
			x: Math.random() * W,
			y: Math.random() * H,
			vx: (1.5 + Math.random() * 2) * (Math.random() < 0.5 ? 1 : -1),
			vy: (1.5 + Math.random() * 2) * (Math.random() < 0.5 ? 1 : -1),
			r: 5 + Math.random() * 9,
			color: C[Math.floor(Math.random() * 6)]
		}));

		const ctx = canvas.getContext('2d')!;

		const tick = () => {
			ctx.clearRect(0, 0, W, H);
			for (const b of balls) {
				b.x += b.vx;
				b.y += b.vy;
				if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
				if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
				if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); }
				if (b.y + b.r > H) { b.y = H - b.r; b.vy = -Math.abs(b.vy); }
				ctx.beginPath();
				ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
				ctx.fillStyle = b.color;
				ctx.fill();
			}
			rafId = requestAnimationFrame(tick);
		};
		rafId = requestAnimationFrame(tick);

		return () => cancelAnimationFrame(rafId);
	});
</script>

<!-- Variant 0: diagonal stripes → NE -->
{#if variant === 0}
	<div class="bg stripe-ne" aria-hidden="true"></div>

<!-- Variant 1: diagonal stripes → NW -->
{:else if variant === 1}
	<div class="bg stripe-nw" aria-hidden="true"></div>

<!-- Variant 2: speaker bass pulse -->
{:else if variant === 2}
	<div class="bg pulse-wrap" aria-hidden="true">
		{#each { length: 6 } as _, i}
			<div class="pulse-ring" style="--c: {C[i]}; animation-delay: {-(i * 0.67).toFixed(2)}s;"></div>
		{/each}
	</div>

<!-- Variant 3: lava lamp blobs -->
{:else if variant === 3}
	<div class="bg lava-wrap" aria-hidden="true">
		{#each blobs as b, i}
			<div
				class="lava-blob"
				style="
					left: {b.left}%; top: {b.top}%;
					width: {b.size}px; height: {b.size}px;
					background: {b.color};
					animation-duration: {b.dur}s;
					animation-delay: {-(i * b.dur * 0.22).toFixed(2)}s;
					--dx1: {b.dx1.toFixed(1)}vw; --dy1: {b.dy1.toFixed(1)}vh;
					--dx2: {b.dx2.toFixed(1)}vw; --dy2: {b.dy2.toFixed(1)}vh;
				"
			></div>
		{/each}
	</div>

<!-- Variant 4: disco ball (canvas) -->
{:else if variant === 4}
	<canvas bind:this={canvas} class="bg disco-canvas" aria-hidden="true"></canvas>

<!-- Variant 5: bokeh -->
{:else if variant === 5}
	<div class="bg bokeh-wrap" aria-hidden="true">
		{#each bokeh as b}
			<div
				class="bokeh-dot"
				style="
					left: {b.left}%;
					width: {b.size}px; height: {b.size}px;
					background: {b.color};
					filter: blur({b.blur}px);
					opacity: {b.opacity};
					animation-delay: {b.delay.toFixed(2)}s;
					animation-duration: {b.dur.toFixed(1)}s;
				"
			></div>
		{/each}
	</div>
{/if}

<style>
	/* ── shared ── */
	.bg {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
	}

	/* ── stripes ──
	   Period: 6 × 150px = 900px along gradient axis.
	   45 ° gradient direction vector: (sin45°, -cos45°) = (0.707, -0.707).
	   One period in screen px: 900 × 0.707 ≈ 636px each axis.
	   inset: -800px ensures the oversized tile always covers the viewport
	   even at the extreme of the translate animation.
	*/
	.stripe-ne,
	.stripe-nw {
		inset: -800px;
		opacity: 0.45;
		will-change: transform;
	}
	.stripe-ne {
		background: repeating-linear-gradient(
			45deg,
			#3b82f6 0px,   #3b82f6 150px,
			#eab308 150px, #eab308 300px,
			#22c55e 300px, #22c55e 450px,
			#ef4444 450px, #ef4444 600px,
			#6366f1 600px, #6366f1 750px,
			#64748b 750px, #64748b 900px
		);
		animation: move-ne 9s linear infinite;
	}
	.stripe-nw {
		background: repeating-linear-gradient(
			315deg,
			#3b82f6 0px,   #3b82f6 150px,
			#eab308 150px, #eab308 300px,
			#22c55e 300px, #22c55e 450px,
			#ef4444 450px, #ef4444 600px,
			#6366f1 600px, #6366f1 750px,
			#64748b 750px, #64748b 900px
		);
		animation: move-nw 9s linear infinite;
	}
	@keyframes move-ne {
		to { transform: translate(636px, -636px); }
	}
	@keyframes move-nw {
		to { transform: translate(-636px, -636px); }
	}

	/* ── speaker pulse ── */
	.pulse-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.pulse-ring {
		position: absolute;
		width: 80px;
		height: 80px;
		border-radius: 50%;
		border: 4px solid var(--c);
		opacity: 0;
		will-change: transform, opacity;
		/* 4s duration; 6 rings × 0.67s spacing → ~90bpm */
		animation: pulse-out 4s ease-out infinite;
	}
	@keyframes pulse-out {
		0%   { transform: scale(1);  opacity: 0.85; }
		100% { transform: scale(28); opacity: 0; }
	}

	/* ── lava lamp ── */
	.lava-wrap {
		overflow: hidden;
	}
	.lava-blob {
		position: absolute;
		border-radius: 40% 60% 60% 40% / 50% 50% 60% 40%;
		filter: blur(80px);
		opacity: 0.5;
		will-change: transform;
		animation: lava-drift ease-in-out infinite alternate;
	}
	@keyframes lava-drift {
		0%   { transform: translate(0, 0) scale(1); }
		20%  { transform: translate(var(--dx1, 8vw), calc(-1 * var(--dy1, 10vh))) scale(1.1); }
		50%  { transform: translate(calc(-1 * var(--dx2, 5vw)), var(--dy2, 8vh)) scale(0.9); }
		75%  { transform: translate(var(--dx1, 8vw), var(--dy2, 8vh)) scale(1.05); }
		100% { transform: translate(calc(-1 * var(--dx2, 5vw)), calc(-1 * var(--dy1, 10vh))) scale(0.95); }
	}

	/* ── disco ball ── */
	.disco-canvas {
		width: 100%;
		height: 100%;
		opacity: 0.7;
	}

	/* ── bokeh ── */
	.bokeh-wrap {
		overflow: hidden;
	}
	.bokeh-dot {
		position: absolute;
		bottom: -200px;
		border-radius: 50%;
		will-change: transform;
		animation: bokeh-rise linear infinite;
	}
	@keyframes bokeh-rise {
		to { transform: translateY(calc(-100vh - 400px)); }
	}
</style>
