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
	 * De tegel herhaalt op een VASTE maat (426px breed vanaf 768px, een volle
	 * kolom daaronder) met de hoogte afgeleid uit de natuurlijke 788x1400-
	 * verhouding van de PNG. Daardoor vervormt de tegel nooit en valt elke laag
	 * precies een tegelhoogte omlaag, wat de lus naadloos maakt ongeacht de
	 * hoogte van de container.
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

	let wrapperClass = $derived(`mixup-coderain ${className}`.trim());
</script>

<div class={wrapperClass} aria-hidden="true" style="--cr-tile: {tile}; --cr-scale: {opacity};">
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

		/* Referentiepunt voor 100cqw = de eigen breedte van de wrapper. */
		container-type: inline-size;

		/* Tegelmaat. De hoogte wordt ALTIJD uit de breedte afgeleid met de
		   natuurlijke verhouding van de PNG (788x1400), zodat de tegel nooit
		   vervormt — ongeacht hoe hoog de pagina of de container is.
		   Smal scherm: precies een volle kolom. */
		--cr-tile-w: 100cqw;
		--cr-tile-h: calc(var(--cr-tile-w) * 1400 / 788);
	}

	/* Vanaf tablet/TV: vaste tegelbreedte, zodat de code zich als meerdere
	   smalle kolommen naast elkaar HERHAALT i.p.v. tot schermbreedte te worden
	   opgerekt. 426px is de designwaarde ("tile-breedte 426px op 1920px" =
	   4,5 kolommen; 3,4 kolommen op 1440px). */
	@media (min-width: 768px) {
		.mixup-coderain {
			--cr-tile-w: 426px;
		}
	}

	.cr-layer {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		/* 200% + een tegel: de laag blijft de container dekken op zowel het
		   begin- als het eindframe van de val, ook in korte containers. */
		height: calc(200% + var(--cr-tile-h));
		background-image: var(--cr-tile);
		background-repeat: repeat;
		background-size: var(--cr-tile-w) var(--cr-tile-h);
		mix-blend-mode: screen;
		will-change: transform;
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

	/* Elke laag valt precies EEN tegelhoogte omlaag en herhaalt dan naadloos.
	   De onderlinge offsets (0 / 10% / 20% van een tegel) komen uit de
	   designwaardes -50%/0, -55%/-5% en -60%/-10% van de laaghoogte. */
	@keyframes mixup-rain-a {
		from {
			transform: translateY(calc(-1 * var(--cr-tile-h)));
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes mixup-rain-b {
		from {
			transform: translateY(calc(-1.1 * var(--cr-tile-h)));
		}
		to {
			transform: translateY(calc(-0.1 * var(--cr-tile-h)));
		}
	}

	@keyframes mixup-rain-c {
		from {
			transform: translateY(calc(-1.2 * var(--cr-tile-h)));
		}
		to {
			transform: translateY(calc(-0.2 * var(--cr-tile-h)));
		}
	}
</style>
