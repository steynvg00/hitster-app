<script lang="ts">
	/**
	 * Gedeelde schil van elk mobiel spelerscherm (redesign fase 2).
	 *
	 * Referentiemaat 390x844. Bevat wat elk scherm uit de designbron deelt:
	 * de radiale paginagradient, de kristal-hoeken-overlay en de vaste
	 * boven-/ondermarge (56px / 30px, met safe-area-insets erbij op echte
	 * toestellen). De code-regen staat standaard UIT: in de designbron heeft
	 * alleen het onboardingscherm regen, de andere schermen niet.
	 */
	import type { Snippet } from 'svelte';
	import CodeRain from '$lib/components/CodeRain.svelte';
	import { OVERLAY_ASSETS } from '$lib/mixup-assets';

	type Props = {
		/** Code-regen tonen (alleen onboarding + pre-game poort in de designbron). */
		rain?: boolean;
		layers?: 2 | 3;
		/** Opacity van de kristal-hoeken: 0.4 op onboarding, 0.35 elders. */
		corners?: number;
		/** Extra achtergrond ONDER de gradient-laag, bijv. de teamkleur-radial. */
		backdrop?: string | null;
		/**
		 * Scherm exact zo hoog als het viewport houden in plaats van mee te groeien
		 * met de inhoud. Nodig voor schermen met een eigen scrollgebied én een vaste
		 * voet (7B: de antwoordkaart scrollt, powerups + knop blijven onderaan) —
		 * met alleen `min-height` groeit de kolom door en scrollt de héle pagina,
		 * waardoor de voet uit beeld loopt.
		 */
		fitViewport?: boolean;
		class?: string;
		children?: Snippet;
	};

	let {
		rain = false,
		layers = 3,
		corners = 0.35,
		backdrop = null,
		fitViewport = false,
		class: className = '',
		children
	}: Props = $props();
</script>

<div class="player-screen mixup-page" class:player-screen--fit={fitViewport}>
	{#if rain}
		<CodeRain {layers} />
	{/if}
	{#if backdrop}
		<div class="absolute inset-0" style="background: {backdrop};"></div>
	{/if}
	<img
		src={OVERLAY_ASSETS.frameCorners}
		alt=""
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 h-full w-full object-cover"
		style="opacity: {corners};"
	/>
	<div class="player-screen__body {className}">
		{@render children?.()}
	</div>
</div>

<style>
	.player-screen {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 100svh;
		overflow: hidden;
		box-sizing: border-box;
		/* Designbron: padding 56px 0 30px. Op echte toestellen mag de notch
		   niet over de inhoud vallen, vandaar de safe-area-ondergrens.
		   Sinds viewport-fit=cover in app.html leveren deze env()'s echte
		   waarden op (daarvoor altijd 0): de achtergrond loopt door tot achter
		   de dynamic island en de browserbalk, de INHOUD blijft ervoor. */
		padding-top: max(56px, calc(env(safe-area-inset-top, 0px) + 14px));
		padding-bottom: max(30px, calc(env(safe-area-inset-bottom, 0px) + 8px));
		/* Links/rechts alleen in landschap of op toestellen met zijinsets; in
		   portret is dit 0 en verandert er niets aan de designmaten. */
		padding-left: env(safe-area-inset-left, 0px);
		padding-right: env(safe-area-inset-right, 0px);
		font-family: var(--font-ui);
		color: var(--color-mixup-paper);
	}

	/* Vaste viewporthoogte: de kolom mag niet met de inhoud meegroeien, anders
	   krijgt het scrollgebied binnenin (min-height:0 + overflow-y:auto) nooit
	   een definitieve hoogte om binnen te scrollen — dan groeit de pagina en
	   scrolt de voet (powerups + knop) uit beeld. */
	.player-screen--fit {
		height: 100svh;
		max-height: 100svh;
	}

	.player-screen__body {
		position: relative;
		/* BEWUST geen z-index: een z-index maakt hier een stacking context en dan
		   kan mix-blend-mode:screen binnen het scherm (splashvideo, gameset-logo)
		   niet meer tegen de paginagradient blenden — dan blijft het zwart staan.
		   De body is een positioned sibling NA de overlays, dus hij schildert er
		   sowieso overheen. */
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}
</style>
