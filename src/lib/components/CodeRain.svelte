<script lang="ts">
	/**
	 * M!XUP code-regen — verplicht op alle donkere schermen.
	 *
	 * Drie gestapelde lagen van dezelfde tegel
	 * (/uploads/voor-claude-design/overlay-coderain_cyaan.png), elk absoluut
	 * gepositioneerd op height:200% met repeat en mix-blend-mode:screen. De
	 * magenta- en groenlaag ontstaan via hue-rotate op dezelfde cyane tegel.
	 *
	 * Laag 1 — cyaan,   opacity 0.26, translateY(-50% -> 0%),   9s
	 * Laag 2 — magenta, opacity 0.20, hue-rotate(-62deg) sat 1.35, 6.4s
	 * Laag 3 — groen,   opacity 0.18, hue-rotate(118deg) sat 1.4, 13s
	 *
	 * Nooit statisch. De wrapper krijgt overflow:hidden + contain:paint, de
	 * lagen will-change:transform.
	 *
	 * Gebruik — zet de component als eerste kind in een `position:relative`
	 * container; de inhoud daarna met een hogere z-index of gewoon erna:
	 *
	 *   <div class="mixup-page relative overflow-hidden">
	 *     <CodeRain />
	 *     <div class="relative z-10">…inhoud…</div>
	 *   </div>
	 *
	 * Props:
	 *   layers  — 3 (default) of 2. Op zeer grote schermen mag 2 voor performance.
	 *   opacity — schaalfactor over alle lagen (1 = de designwaardes).
	 *   class   — extra classes op de wrapper (bijv. een afwijkende inset/radius).
	 */
	import { OVERLAY_ASSETS } from '$lib/mixup-assets';

	type Props = {
		layers?: 2 | 3;
		opacity?: number;
		class?: string;
	};

	let { layers = 3, opacity = 1, class: className = '' }: Props = $props();

	const tile = `url(${OVERLAY_ASSETS.codeRain})`;
</script>

<div
	class="mixup-coderain {className}"
	aria-hidden="true"
	style="--cr-tile: {tile}; --cr-scale: {opacity};"
>
	<div class="cr-layer cr-layer--cyan"></div>
	<div class="cr-layer cr-layer--magenta"></div>
	{#if layers >= 3}
		<div class="cr-layer cr-layer--green"></div>
	{/if}
</div>

<style>
	.mixup-coderain {
		position: absolute;
		inset: 0;
		overflow: hidden;
		contain: paint;
		pointer-events: none;
		mix-blend-mode: screen;
		z-index: 0;
	}

	.cr-layer {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 200%;
		background-image: var(--cr-tile);
		/* Mobiel (390px referentie): de tegel spant de volle breedte. */
		background-repeat: repeat-y;
		background-size: 100% 50%;
		mix-blend-mode: screen;
		will-change: transform;
	}

	/* Vanaf tablet/TV: vaste tegelbreedte van 426px (3 tegels op 1280px,
	   ~4,5 op 1920px) zodat de regen niet uitgerekt wordt. */
	@media (min-width: 768px) {
		.cr-layer {
			background-repeat: repeat;
			background-size: 426px 50%;
		}
	}

	.cr-layer--cyan {
		opacity: calc(0.26 * var(--cr-scale, 1));
		animation: mixup-rain-a 9s linear infinite;
	}

	.cr-layer--magenta {
		opacity: calc(0.2 * var(--cr-scale, 1));
		filter: hue-rotate(-62deg) saturate(1.35);
		animation: mixup-rain-b 6.4s linear infinite;
	}

	.cr-layer--green {
		opacity: calc(0.18 * var(--cr-scale, 1));
		filter: hue-rotate(118deg) saturate(1.4);
		animation: mixup-rain-c 13s linear infinite;
	}

	@keyframes mixup-rain-a {
		from {
			transform: translateY(-50%);
		}
		to {
			transform: translateY(0%);
		}
	}

	@keyframes mixup-rain-b {
		from {
			transform: translateY(-55%);
		}
		to {
			transform: translateY(-5%);
		}
	}

	@keyframes mixup-rain-c {
		from {
			transform: translateY(-60%);
		}
		to {
			transform: translateY(-10%);
		}
	}
</style>
