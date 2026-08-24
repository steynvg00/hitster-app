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
		class?: string;
		children?: Snippet;
	};

	let {
		rain = false,
		layers = 3,
		corners = 0.35,
		backdrop = null,
		class: className = '',
		children
	}: Props = $props();
</script>

<div class="player-screen mixup-page">
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
		   niet over de inhoud vallen, vandaar de safe-area-ondergrens. */
		padding-top: max(56px, calc(env(safe-area-inset-top, 0px) + 14px));
		padding-bottom: max(30px, calc(env(safe-area-inset-bottom, 0px) + 8px));
		font-family: var(--font-ui);
		color: var(--color-mixup-paper);
	}

	.player-screen__body {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}
</style>
