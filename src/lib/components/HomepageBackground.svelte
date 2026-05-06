<script lang="ts">
	import { onMount } from 'svelte';

	// Team palette: blue, yellow, green, red, indigo, slate
	const C = ['#3b82f6', '#eab308', '#22c55e', '#ef4444', '#6366f1', '#64748b'];

	// 0 = stripes NE, 1 = stripes NW,
	// 2 = bouncing bubbles, 3 = grow/shrink, 4 = fade in/out, 5 = flat lava lamp
	let variant = $state(-1);

	type Dot = { left: number; top: number; size: number; color: string; dur: number; delay: number; driftX?: number };
	let dots: Dot[] = $state([]);

	let canvas: HTMLCanvasElement | null = $state(null);
	let rafId = 0;

	onMount(() => {
		variant = Math.floor(Math.random() * 6);

		if (variant === 3) {
			// grow/shrink: scattered circles
			dots = Array.from({ length: 18 }, (_, i) => ({
				left: 3 + Math.random() * 90,
				top: 3 + Math.random() * 90,
				size: 40 + Math.random() * 90,
				color: C[i % 6],
				dur: 2.5 + Math.random() * 4,
				delay: -(Math.random() * 8)
			}));
		} else if (variant === 4) {
			// fade in/out: scattered circles
			dots = Array.from({ length: 18 }, (_, i) => ({
				left: 3 + Math.random() * 90,
				top: 3 + Math.random() * 90,
				size: 40 + Math.random() * 90,
				color: C[i % 6],
				dur: 4 + Math.random() * 5,
				delay: -(Math.random() * 9)
			}));
		} else if (variant === 5) {
			// flat lava lamp: large bubbles in lower portion, alternate float up/down
			dots = Array.from({ length: 14 }, (_, i) => ({
				left: 3 + Math.random() * 88,
				top: 48 + Math.random() * 42,
				size: 55 + Math.random() * 110,
				color: C[i % 6],
				dur: 6 + Math.random() * 8,
				delay: -(Math.random() * 14),
				driftX: (Math.random() - 0.5) * 15
			}));
		}

		return () => { if (rafId) cancelAnimationFrame(rafId); };
	});

	// Bouncing bubbles — start rAF once canvas is bound
	$effect(() => {
		if (variant !== 2 || !canvas) return;

		const W = window.innerWidth;
		const H = window.innerHeight;
		canvas.width = W;
		canvas.height = H;

		type Ball = { x: number; y: number; vx: number; vy: number; r: number; color: string };
		const balls: Ball[] = Array.from({ length: 15 }, () => ({
			x: Math.random() * W,
			y: Math.random() * H,
			vx: (0.8 + Math.random() * 1.5) * (Math.random() < 0.5 ? 1 : -1),
			vy: (0.8 + Math.random() * 1.5) * (Math.random() < 0.5 ? 1 : -1),
			r: 28 + Math.random() * 52,
			color: C[Math.floor(Math.random() * 6)]
		}));

		const ctx = canvas.getContext('2d')!;
		ctx.globalAlpha = 0.82;

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

	/*
	 * DISABLED — old circle variants (kept for reference, not reachable)
	 *
	 * Old variant 2: speaker bass pulse
	 * Old variant 3: blurry lava lamp blobs
	 * Old variant 4: disco ball (small dots, canvas)
	 * Old variant 5: bokeh
	 *
	 * These used filter:blur() effects which didn't match the flat stripe aesthetic.
	 * Replaced by flat bubble variants above.
	 *
	 * Old state vars that drove them:
	 *   type BlobDef = { left, top, size, color, dur, dx1, dy1, dx2, dy2 }
	 *   type BokehDef = { left, size, color, blur, delay, dur, opacity }
	 *   let blobs: BlobDef[] = $state([]);
	 *   let bokeh: BokehDef[] = $state([]);
	 */
</script>

<!-- Variant 0: diagonal stripes → NE -->
{#if variant === 0}
	<div class="bg stripe-ne" aria-hidden="true"></div>

<!-- Variant 1: diagonal stripes → NW -->
{:else if variant === 1}
	<div class="bg stripe-nw" aria-hidden="true"></div>

<!-- Variant 2: bouncing bubbles (flat, canvas) -->
{:else if variant === 2}
	<canvas bind:this={canvas} class="bg bounce-canvas" aria-hidden="true"></canvas>

<!-- Variant 3: growing / shrinking bubbles (flat) -->
{:else if variant === 3}
	<div class="bg dots-wrap" aria-hidden="true">
		{#each dots as d}
			<div
				class="dot grow-dot"
				style="left:{d.left}%;top:{d.top}%;width:{d.size}px;height:{d.size}px;background:{d.color};animation-duration:{d.dur.toFixed(2)}s;animation-delay:{d.delay.toFixed(2)}s;"
			></div>
		{/each}
	</div>

<!-- Variant 4: fading in / out bubbles (flat) -->
{:else if variant === 4}
	<div class="bg dots-wrap" aria-hidden="true">
		{#each dots as d}
			<div
				class="dot fade-dot"
				style="left:{d.left}%;top:{d.top}%;width:{d.size}px;height:{d.size}px;background:{d.color};animation-duration:{d.dur.toFixed(2)}s;animation-delay:{d.delay.toFixed(2)}s;"
			></div>
		{/each}
	</div>

<!-- Variant 5: flat lava lamp bubbles -->
{:else if variant === 5}
	<div class="bg dots-wrap" aria-hidden="true">
		{#each dots as d}
			<div
				class="dot lava-dot"
				style="left:{d.left}%;top:{d.top}%;width:{d.size}px;height:{d.size}px;background:{d.color};animation-duration:{d.dur.toFixed(2)}s;animation-delay:{d.delay.toFixed(2)}s;--drift-x:{(d.driftX ?? 0).toFixed(1)}vw;"
			></div>
		{/each}
	</div>
{/if}

<!--
DISABLED — old circle variant markup (variants 6–9, unreachable).
Kept as reference; remove once new variants are confirmed satisfactory.

Variant 6 (old 2): speaker bass pulse
  <div class="bg pulse-wrap" aria-hidden="true">
    {#each { length: 6 } as _, i}
      <div class="pulse-ring" style="- -c:{C[i]};animation-delay:{-(i*0.67).toFixed(2)}s;"></div>
    {/each}
  </div>

Variant 7 (old 3): blurry lava lamp
  <div class="bg lava-wrap" aria-hidden="true">
    {#each blobs as b, i}
      <div class="lava-blob" style="left:{b.left}%;top:{b.top}%;width:{b.size}px;height:{b.size}px;background:{b.color};animation-duration:{b.dur}s;animation-delay:{-(i*b.dur*0.22).toFixed(2)}s;- -dx1:{b.dx1}vw;- -dy1:{b.dy1}vh;- -dx2:{b.dx2}vw;- -dy2:{b.dy2}vh;"></div>
    {/each}
  </div>

Variant 8 (old 4): disco ball (small dots, canvas)
  <canvas bind:this={canvas} class="bg disco-canvas" aria-hidden="true"></canvas>

Variant 9 (old 5): bokeh (blurry circles drifting up)
  <div class="bg bokeh-wrap" aria-hidden="true">
    {#each bokeh as b}
      <div class="bokeh-dot" style="left:{b.left}%;width:{b.size}px;height:{b.size}px;background:{b.color};filter:blur({b.blur}px);opacity:{b.opacity};animation-delay:{b.delay.toFixed(2)}s;animation-duration:{b.dur.toFixed(1)}s;"></div>
    {/each}
  </div>
-->

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
	   45° direction vector (sin45°, -cos45°) = (0.707, -0.707).
	   One seamless-loop translation: 900 × 0.707 ≈ 636px per axis.
	   inset: -800px keeps the oversized tile covering the viewport
	   throughout the full translate range.
	*/
	.stripe-ne,
	.stripe-nw {
		inset: -800px;
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

	/* ── bouncing bubbles ── */
	.bounce-canvas {
		width: 100%;
		height: 100%;
	}

	/* ── shared flat dot base ── */
	.dots-wrap {
		overflow: hidden;
	}
	.dot {
		position: absolute;
		border-radius: 50%;
		transform-origin: center;
		will-change: transform, opacity;
	}

	/* ── growing / shrinking ── */
	.grow-dot {
		animation: grow-shrink ease-in-out infinite alternate;
	}
	@keyframes grow-shrink {
		from { transform: scale(0.2);  opacity: 0.4; }
		to   { transform: scale(1.0);  opacity: 0.85; }
	}

	/* ── fading in / out ── */
	.fade-dot {
		animation: fade-pop ease-in-out infinite;
	}
	@keyframes fade-pop {
		0%   { opacity: 0;    transform: scale(0.88); }
		20%  { opacity: 0.85; transform: scale(1); }
		80%  { opacity: 0.85; transform: scale(1); }
		100% { opacity: 0;    transform: scale(0.88); }
	}

	/* ── flat lava lamp ── */
	.lava-dot {
		animation: lava-float ease-in-out infinite alternate;
	}
	@keyframes lava-float {
		from { transform: translate(0, 0) scale(1);   opacity: 0.6; }
		to   { transform: translate(var(--drift-x, 0vw), -38vh) scale(1.25); opacity: 0.9; }
	}

	/*
	 * DISABLED — old CSS for blurry circle variants (kept for reference)
	 *
	 * .pulse-wrap { display: flex; align-items: center; justify-content: center; }
	 * .pulse-ring { position: absolute; width: 80px; height: 80px; border-radius: 50%;
	 *   border: 4px solid var(- -c); opacity: 0; will-change: transform, opacity;
	 *   animation: pulse-out 4s ease-out infinite; }
	 * @keyframes pulse-out { 0% { transform: scale(1); opacity: .85; } 100% { transform: scale(28); opacity: 0; } }
	 *
	 * .lava-wrap { overflow: hidden; }
	 * .lava-blob { position: absolute; border-radius: 40% 60% 60% 40% / 50% 50% 60% 40%;
	 *   filter: blur(80px); opacity: .5; will-change: transform;
	 *   animation: lava-drift ease-in-out infinite alternate; }
	 * @keyframes lava-drift { ... }
	 *
	 * .disco-canvas { width: 100%; height: 100%; opacity: .7; }
	 *
	 * .bokeh-wrap { overflow: hidden; }
	 * .bokeh-dot { position: absolute; bottom: -200px; border-radius: 50%;
	 *   will-change: transform; animation: bokeh-rise linear infinite; }
	 * @keyframes bokeh-rise { to { transform: translateY(calc(-100vh - 400px)); } }
	 */
</style>
