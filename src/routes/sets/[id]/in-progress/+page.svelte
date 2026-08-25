<script lang="ts">
	/**
	 * 03a · TUSSENSCHERM — "Het spel is al bezig" (redesign fase 6).
	 *
	 * Bron: design/M!XUP Ceremonie en Randen.dc.html, scherm "03a Spel al bezig".
	 * Koptelefoon-kristal met cyane glow, kop 40px, regel, knoppen.
	 *
	 * PUUR PRESENTATIE — de load-functie (play_state-poort) is ongewijzigd.
	 *
	 * AFWIJKING VAN DE DESIGNBRON: die toont een primaire knop "SPRING IN".
	 * Laat-instappen bestaat niet in de backend — /sets/[id]/join stuurt een
	 * speler tijdens `playing` juist HIERHEEN terug, dus die knop zou een lus
	 * zijn. De live stand schuift daarom naar de primaire plek en de regel
	 * belooft niets wat het spel niet waarmaakt.
	 */
	import Interstitial from '$lib/components/game/Interstitial.svelte';
	import { ICON_ASSETS } from '$lib/mixup-assets';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Spel al bezig — M!XUP</title>
</svelte:head>

<Interstitial
	icon={ICON_ASSETS.headphones}
	glow="rgba(0, 229, 255, 0.35)"
	eyebrow={data.setName}
	title="Het spel is al bezig"
	lede="Deze ronde loopt al. Vraag de host of je nog kunt instappen."
>
	<a href="/leaderboard" class="mixup-btn mixup-btn-primary">Bekijk de live stand</a>
	<a href="/" class="mixup-btn mixup-btn-ghost">Terug naar start</a>
</Interstitial>
