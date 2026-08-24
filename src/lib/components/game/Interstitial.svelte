<script lang="ts">
	/**
	 * 03 · TUSSENSCHERMEN — gedeelde schil (redesign fase 6).
	 *
	 * Bron: design/M!XUP Ceremonie en Randen.dc.html, scherm "03 · TUSSENSCHERMEN
	 * — AL BEZIG · VOORBIJ · GEEN SPEL". De drie schermen (03a/03b/03c) verschillen
	 * alleen in kristal-icoon, glowkleur, kop, regel en knoppen; de rest is
	 * identiek. Vandaar een component in plaats van drie kopieën.
	 *
	 * Referentiemaat 390x844 — dit zijn TELEFOON-schermen, geen TV: een speler
	 * belandt hier na een NFC-tap of via de join-URL. GEEN code-regen; de
	 * designbron geeft deze drie alleen de kristal-hoeken op opacity 0.4.
	 *
	 * PUUR PRESENTATIE. De load-functies die hierheen sturen zijn ongewijzigd.
	 */
	import type { Snippet } from 'svelte';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';

	type Props = {
		/** Kristal-icoon uit ICON_ASSETS — 110px, met glow. */
		icon: string;
		/** Glowkleur onder het icoon; per scherm anders in de designbron. */
		glow: string;
		/** Mono-label boven de kop, bijv. de naam van de gameset. */
		eyebrow?: string | null;
		title: string;
		lede: string;
		/** De knoppen onder de regel. */
		children?: Snippet;
	};

	let { icon, glow, eyebrow = null, title, lede, children }: Props = $props();
</script>

<PlayerScreen corners={0.4} class="items-center justify-center px-7 text-center">
	<div class="tussen">
		<img src={icon} alt="" aria-hidden="true" class="tussen__icon" style="--glow: {glow};" />

		{#if eyebrow}
			<p class="tussen__eyebrow">{eyebrow}</p>
		{/if}

		<h1 class="tussen__title">{title}</h1>
		<p class="tussen__lede">{lede}</p>

		{#if children}
			<div class="tussen__actions">
				{@render children()}
			</div>
		{/if}
	</div>
</PlayerScreen>

<style>
	.tussen {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		min-height: 0;
	}

	.tussen__icon {
		width: 110px;
		height: 110px;
		object-fit: contain;
		filter: drop-shadow(0 8px 24px var(--glow));
	}

	.tussen__eyebrow {
		margin: 0;
		font-family: var(--font-data);
		font-size: 11px;
		letter-spacing: var(--tracking-mixup-wide);
		text-transform: uppercase;
		color: var(--color-mixup-dim);
	}

	.tussen__title {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 40px;
		line-height: 0.95;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 26px rgba(124, 77, 255, 0.85);
	}

	.tussen__lede {
		margin: 0;
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-mixup-muted);
	}

	.tussen__actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		width: 100%;
		margin-top: 10px;
	}

	/* De designbron geeft elke knop maxWidth 280 en volle breedte daarbinnen. */
	.tussen__actions :global(> *) {
		width: 100%;
		max-width: 280px;
	}
</style>
