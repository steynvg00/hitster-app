<script lang="ts">
	/**
	 * 3A · RANDOMIZER (redesign fase 2) — mobiel, referentie 390x844.
	 *
	 * Drie fases, zelfde timing als voorheen: rollen (0-1.8s) → reveal (1.8s) →
	 * done (3.6s, knop verschijnt). De dobbelsteen rolt in 0.7s; bij de reveal
	 * verschijnt de teamkleur-cirkel met splash-mixup.mp4 erachter
	 * (mix-blend screen, breedte tot de schermranden, z-index onder de tekst).
	 *
	 * GEEN code-regen op dit scherm — de designbron heeft die hier niet, en de
	 * ondergrond is de teamkleur-radial die de video moet laten doorkomen.
	 *
	 * Data-flow ONGEWIJZIGD: het team komt uit de bestaande ?team=-parameter
	 * die de server valideert; deze pagina schrijft niets.
	 */
	import { onMount } from 'svelte';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { ICON_ASSETS, SPLASH_VIDEO } from '$lib/mixup-assets';
	import { teamHex } from '$lib/team-theme';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let phase = $state<'rolling' | 'reveal' | 'done'>('rolling');
	let splashEl = $state<HTMLVideoElement | null>(null);

	const hex = $derived(teamHex(data.team));
	const revealed = $derived(phase === 'reveal' || phase === 'done');
	/** Achtergrond wisselt bij de reveal naar een radial in de teamkleur. */
	const backdrop = $derived(
		revealed ? `radial-gradient(120% 90% at 50% 30%, ${hex}66 0%, #0B0B1F 72%)` : null
	);

	onMount(() => {
		const t1 = setTimeout(() => (phase = 'reveal'), 1800);
		const t2 = setTimeout(() => (phase = 'done'), 3600);
		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
		};
	});

	/**
	 * autoplay+muted+loop+playsinline alleen is niet genoeg: zonder expliciete
	 * play() blijft de video op frame 0 staan. De catch vangt browsers die de
	 * belofte afwijzen.
	 */
	$effect(() => {
		if (!splashEl) return;
		splashEl.muted = true;
		splashEl.loop = true;
		void splashEl.play().catch(() => {});
	});
</script>

<svelte:head>
	<title>Je team — M!XUP</title>
</svelte:head>

<!--
	.randomizer: vaste viewporthoogte (100dvh) zodat dit scherm nooit scrolt.
	De 190px-spacer boven de cirkel mag krimpen (shrink) — op een iPhone SE
	(375x667) is dat de enige ruimte die weg kan zonder de knop uit beeld te
	duwen.
-->
<div class="randomizer">
	<PlayerScreen {backdrop} class="items-center px-7 text-center">
		<div class="h-[190px] shrink"></div>

		<div class="relative flex h-[190px] w-[190px] flex-none items-center justify-center">
			{#if phase === 'rolling'}
				<img
					src={ICON_ASSETS.dice}
					alt=""
					class="dice h-40 w-40 object-contain"
					style="filter: drop-shadow(0 14px 34px rgba(255,45,170,0.5));"
				/>
			{:else}
				<video
					bind:this={splashEl}
					src={SPLASH_VIDEO}
					autoplay
					muted
					loop
					playsinline
					class="splash"
				></video>
				<div class="reveal-circle" style="--tc: {hex};"></div>
			{/if}
		</div>

		<div class="relative z-10 flex w-full flex-1 flex-col items-center gap-4 pt-16">
			{#if phase === 'rolling'}
				<div
					class="font-display text-[38px] font-black text-mixup-paper uppercase"
					style="text-shadow: 0 0 26px rgba(124,77,255,0.85);"
				>
					We zoeken je team…
				</div>
				<div class="text-[13px] font-medium text-mixup-muted">Het lot beslist. Even geduld.</div>
			{:else}
				<div class="text-[13px] font-extrabold tracking-[0.3em] text-mixup-paper">
					JIJ SPEELT VOOR
				</div>
				<div
					class="font-display text-[58px] leading-[0.9] font-black text-mixup-paper uppercase"
					style="text-shadow: 0 0 40px {hex};"
				>
					{data.label}
				</div>
			{/if}

			<div class="flex h-14 flex-none items-center justify-center">
				{#if phase === 'done'}
					<a href="/team" class="go-btn squircle">NAAR JE TEAM →</a>
				{/if}
			</div>
		</div>
	</PlayerScreen>
</div>

<style>
	/* Viewport-vast: dvh volgt de iOS-adresbalk (svh/vh niet), dus geen
	   scrollruimte als de balk inklapt of uitklapt. Alleen hier, via de
	   .randomizer-wrapper — PlayerScreen zelf blijft min-height:100svh. */
	.randomizer :global(.player-screen) {
		height: 100dvh;
		min-height: 100dvh;
		max-height: 100dvh;
	}

	.dice {
		animation: dice-roll 0.7s cubic-bezier(0.45, 0, 0.55, 1) infinite;
	}

	@keyframes dice-roll {
		0% {
			transform: rotate(0deg) scale(1);
		}
		50% {
			transform: rotate(180deg) scale(1.15);
		}
		100% {
			transform: rotate(360deg) scale(1);
		}
	}

	/* Splash vult de volle schermbreedte en zit ACHTER cirkel én tekst. */
	.splash {
		position: absolute;
		left: 50%;
		/* Designformule: top = 95 + splashY - (h - 240) / 2, met splashY = -123 en
		   h = breedte * 16/9. Bij 390px breed geeft dat -254.7px. */
		top: calc(92px - 100vw * 8 / 9);
		width: 100vw;
		max-width: 100vw;
		height: calc(100vw * 16 / 9);
		margin-left: -50vw;
		object-fit: contain;
		mix-blend-mode: screen;
		pointer-events: none;
		opacity: 0.95;
		filter: contrast(1.4) brightness(1.05);
		z-index: 0;
	}

	.reveal-circle {
		position: relative;
		z-index: 1;
		width: 170px;
		height: 170px;
		border-radius: 50%;
		background: var(--tc);
		border: 3px solid rgba(255, 255, 255, 0.5);
		box-shadow:
			0 0 70px color-mix(in srgb, var(--tc) 67%, transparent),
			0 0 150px color-mix(in srgb, var(--tc) 33%, transparent),
			inset 0 -14px 40px rgba(0, 0, 0, 0.25);
		animation: reveal-pop 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}

	@keyframes reveal-pop {
		0% {
			transform: scale(0.2) rotate(-8deg);
			opacity: 0;
		}
		55% {
			transform: scale(1.12) rotate(2deg);
			opacity: 1;
		}
		100% {
			transform: scale(1) rotate(0deg);
			opacity: 1;
		}
	}

	.go-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 54px;
		padding: 0 28px;
		border-radius: 26px;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 16px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		background: linear-gradient(90deg, #ffe600, #ff7f11);
		color: #1a1400;
		box-shadow: 0 10px 30px rgba(255, 127, 17, 0.35);
		animation: reveal-pop 0.5s ease both;
	}
</style>
