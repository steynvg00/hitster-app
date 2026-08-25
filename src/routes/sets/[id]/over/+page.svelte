<script lang="ts">
	/**
	 * 03b · TUSSENSCHERM — "Dit spel is voorbij" (redesign fase 6).
	 *
	 * Bron: design/M!XUP Ceremonie en Randen.dc.html, scherm "03b Spel voorbij".
	 * Finish-vlag-kristal met gele glow, kop 40px, secundaire knop naar de
	 * eindstand.
	 *
	 * PUUR PRESENTATIE — de load-functie is ongewijzigd. De tweede knop (live
	 * stand) stond al op dit scherm en blijft, nu als ghost.
	 */
	import Interstitial from '$lib/components/game/Interstitial.svelte';
	import { ICON_ASSETS } from '$lib/mixup-assets';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Spel voorbij — M!XUP</title>
</svelte:head>

<Interstitial
	icon={ICON_ASSETS.finishFlag}
	glow="rgba(255, 230, 0, 0.3)"
	eyebrow={data.setName}
	title="Dit spel is voorbij"
	lede="De winnaar is al gekroond. Bekijk de eindstand of wacht op een nieuw spel."
>
	<a href="/sets/{data.setId}/podium" class="mixup-btn mixup-btn-secondary">Bekijk de eindstand</a>
	<a href="/leaderboard" class="mixup-btn mixup-btn-ghost">Bekijk de live stand</a>
</Interstitial>
