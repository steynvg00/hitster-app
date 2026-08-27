<script lang="ts">
	/**
	 * 04 · NFC-TAP-MOMENT — "de halve seconde" (redesign fase 6).
	 *
	 * Bron: design/M!XUP Ceremonie en Randen.dc.html, scherm "04 NFC-tap".
	 * Referentiemaat 390x844. Twee uitdijende ringen achter een ademende cirkel
	 * in de teamkleur, met het M!XUP-logo in mix-blend screen.
	 *
	 * PUUR PRESENTATIE — geen load, geen fetch, geen timer die ergens heen
	 * navigeert. De component toont alleen; wie hem toont bepaalt wanneer.
	 *
	 * AFWIJKING VAN DE DESIGNBRON: die zet `logo-mixup_shatter_alpha.png` in de
	 * cirkel. Dat bestand hoort bij de oude shatter-set en README § Assets
	 * schrijft `mixup_spin_clean.png` voor als het ENIGE toegestane logo
	 * ("vervangt drip/shatter overal"). Dus MIXUP_LOGO.
	 *
	 * De schil is PlayerScreen met de teamkleur-radial als `backdrop` — precies
	 * de use case die daar gedocumenteerd staat. Geen kristal-hoeken: de
	 * designbron geeft dit scherm er geen (corners={false}), en geen code-regen.
	 */
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { MIXUP_LOGO } from '$lib/mixup-assets';
	import { teamHex, teamGlow } from '$lib/team-theme';

	type Props = {
		/** Teamkleur (blue | yellow | green | red | indigo | black). */
		color?: string | null;
		title?: string;
		lede?: string;
	};

	let { color = null, title = 'Tap gelukt!', lede = 'Challenge wordt geladen…' }: Props = $props();

	const hex = $derived(teamHex(color));
	const glow = $derived(teamGlow(color));
</script>

<PlayerScreen
	corners={false}
	backdrop="radial-gradient(120% 90% at 50% 45%, {hex}4D 0%, #0B0B1F 70%)"
	class="items-center justify-center text-center"
>
	<div class="tap" style="--team: {hex}; --team-glow: {glow};">
		<div class="tap__stage">
			<span class="tap__ripple"></span>
			<span class="tap__ripple tap__ripple--b"></span>
			<div class="tap__circle">
				<img src={MIXUP_LOGO} alt="M!XUP" class="tap__logo" />
			</div>
		</div>

		<h1 class="tap__title">{title}</h1>
		<p class="tap__lede">{lede}</p>
	</div>
</PlayerScreen>

<style>
	.tap {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 20px;
		min-height: 0;
	}

	.tap__stage {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 170px;
		height: 170px;
	}

	.tap__ripple {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 3px solid var(--team);
		animation: tap-ripple 1.6s ease-out infinite;
	}

	.tap__ripple--b {
		animation-delay: 0.8s;
	}

	.tap__circle {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 150px;
		height: 150px;
		border-radius: 50%;
		background: rgba(11, 11, 31, 0.6);
		border: 3px solid var(--team);
		box-shadow: 0 0 50px color-mix(in srgb, var(--team-glow) 60%, transparent);
		animation: tap-breathe 1.6s ease-in-out infinite;
	}

	.tap__logo {
		width: 90px;
		mix-blend-mode: screen;
	}

	.tap__title {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 34px;
		line-height: 1;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 26px var(--team-glow);
	}

	.tap__lede {
		margin: 0;
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 13px;
		color: var(--color-mixup-muted);
	}

	@keyframes tap-ripple {
		from {
			transform: scale(0.6);
			opacity: 0.9;
		}
		to {
			transform: scale(1.8);
			opacity: 0;
		}
	}

	@keyframes tap-breathe {
		0%,
		100% {
			opacity: 0.5;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.06);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tap__ripple,
		.tap__circle {
			animation: none;
		}
		.tap__circle {
			opacity: 1;
		}
	}
</style>
