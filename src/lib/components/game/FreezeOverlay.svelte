<script lang="ts">
	/**
	 * Scherm 6 — FREEZE-OVERLAY. De achtergrond bevriest echt: de rijp groeit
	 * aan, het ijs "ademt", een sheen loopt er doorheen en er dwarrelen
	 * ijskristallen langs. De animaties LOPEN zolang de overlay staat.
	 *
	 * PUUR PRESENTATIE. Deze component telt niet af, luistert nergens naar en
	 * post nergens naartoe: de challenge-pagina houdt `freezeUntil` /
	 * `freezeRemainingMs` bij (uit de bestaande realtime INSERT op team_effects)
	 * en geeft de resterende seconden hier binnen. Voorheen stond dezelfde
	 * blokkerende laag inline in de pagina; alleen de vormgeving is anders.
	 *
	 * Designbron: M!XUP Powerup-Laag.dc.html, artboard "6 Freeze".
	 */
	import { powerupIcon } from '$lib/mixup-assets';

	let {
		sourceName,
		secondsLeft
	}: {
		/** Het team dat bevroor. Komt uit payload.source_team_name, ongewijzigd. */
		sourceName: string;
		/** Resterende seconden, door de pagina berekend. */
		secondsLeft: number;
	} = $props();

	// Vaste posities/maten voor de dwarrelende kristallen — geen randomness, dus
	// de bevriezing ziet er elke keer hetzelfde uit.
	const SHARDS = [
		{ left: '14%', size: 10, dur: '6s', delay: '0s', op: 0.75 },
		{ left: '42%', size: 7, dur: '7.5s', delay: '1.2s', op: 0.6 },
		{ left: '68%', size: 12, dur: '8.4s', delay: '0.6s', op: 0.55 },
		{ left: '86%', size: 8, dur: '6.8s', delay: '2.1s', op: 0.7 }
	];
</script>

<div class="freeze" role="alert" aria-live="assertive">
	<!-- Laag 1: de rijp groeit vanaf de randen naar binnen. -->
	<div class="frost-grow"></div>
	<!-- Laag 2: kristalstructuur die langzaam ademt. -->
	<div class="frost-lines"></div>
	<!-- Laag 3: sheen + dwarrelende kristallen. -->
	<div class="ice-fx">
		<div class="sheen"></div>
		{#each SHARDS as s, i (i)}
			<span
				class="shard"
				style="left: {s.left}; width: {s.size}px; height: {s.size}px; opacity: {s.op}; animation-duration: {s.dur}; animation-delay: {s.delay};"
			></span>
		{/each}
	</div>

	<!-- Laag 4: de boodschap. -->
	<div class="freeze-body">
		<img src={powerupIcon('freeze')} alt="" class="freeze-icon" />
		<div class="freeze-title">Bevroren!</div>
		<div class="freeze-sub">{sourceName} heeft jullie bevroren</div>
		<div class="freeze-count tabular-nums">{secondsLeft}</div>
	</div>
</div>

<style>
	.freeze {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		/* Volledige schermhoogte, niet inset:0. Het initial containing block is
		   per specificatie zo hoog als de KLEINE viewport, dus `inset: 0` op een
		   fixed laag levert op iOS 100svh op — 714px in een venster van 754px
		   (toestelmeting #106). Dat is variant B uit die diagnose, en die liet
		   onderaan exact die strook van 40px onbeschilderd. 100lvh is de
		   grootste stand die de viewport aanneemt; 100vh staat ervoor als
		   terugval en is op iOS van oudsher al de grote viewport. */
		height: 100vh;
		height: 100lvh;
		z-index: 40;
		overflow: hidden;
		/* Designbron: de blauwe deklaag met een lichte blur eroverheen. Deze laag
		   is wat het formulier fysiek onaanraakbaar maakt — precies zoals de
		   oude inline-overlay dat deed. */
		background: linear-gradient(180deg, rgba(0, 229, 255, 0.2) 0%, rgba(0, 140, 255, 0.3) 100%);
		backdrop-filter: blur(3px);
		-webkit-backdrop-filter: blur(3px);
	}

	.frost-grow,
	.frost-lines,
	.ice-fx {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.frost-grow {
		background: radial-gradient(
			115% 95% at 50% 50%,
			rgba(180, 240, 255, 0.06) 22%,
			rgba(150, 225, 255, 0.42) 78%,
			rgba(120, 205, 255, 0.7) 100%
		);
		animation: frostGrow 2.6s ease-out both;
	}

	.frost-lines {
		background:
			repeating-linear-gradient(58deg, rgba(255, 255, 255, 0.1) 0 2px, transparent 2px 10px),
			repeating-linear-gradient(-58deg, rgba(255, 255, 255, 0.08) 0 2px, transparent 2px 13px);
		animation: frostBreathe 5s ease-in-out infinite;
	}

	.ice-fx {
		overflow: hidden;
	}

	.sheen {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 45%;
		background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.38), transparent);
		animation: iceSheen 4.2s linear infinite;
	}

	.shard {
		position: absolute;
		top: 0;
		background: rgba(255, 255, 255, 0.9);
		transform: rotate(45deg);
		animation-name: iceDrift;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
	}

	.freeze-body {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 0 30px;
		text-align: center;
	}

	.freeze-icon {
		width: 130px;
		height: 130px;
		object-fit: contain;
		filter: drop-shadow(0 0 30px rgba(0, 229, 255, 0.9));
		animation: frostBreathe 3.4s ease-in-out infinite;
	}

	.freeze-title {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 52px;
		line-height: 0.95;
		text-transform: uppercase;
		color: #ffffff;
		text-shadow: 0 0 30px rgba(0, 229, 255, 1);
	}

	.freeze-sub {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 14px;
		color: var(--color-mixup-paper);
	}

	.freeze-count {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 88px;
		line-height: 1;
		color: #ffffff;
		text-shadow: 0 0 40px rgba(0, 229, 255, 1);
	}

	@keyframes frostGrow {
		0% {
			opacity: 0.15;
			transform: scale(1.18);
		}
		100% {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes frostBreathe {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 0.95;
		}
	}

	@keyframes iceSheen {
		0% {
			transform: translateX(-130%) skewX(-12deg);
		}
		100% {
			transform: translateX(240%) skewX(-12deg);
		}
	}

	@keyframes iceDrift {
		0% {
			transform: translateY(-30px) rotate(0deg);
			opacity: 0;
		}
		20% {
			opacity: 0.9;
		}
		100% {
			transform: translateY(100vh) rotate(180deg);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.frost-grow,
		.frost-lines,
		.sheen,
		.shard,
		.freeze-icon {
			animation: none;
		}
		.shard {
			display: none;
		}
	}
</style>
