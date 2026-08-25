<script lang="ts">
	/**
	 * 03a · TUSSENSCHERM — "Het spel is al bezig", NFC-variant (redesign fase 6).
	 *
	 * Zelfde scherm als /sets/[id]/in-progress, bereikt via /nfc/randomize/[set_id].
	 * Die keten is een RESTANT van de NFC-randomizer die bij de join-consolidatie
	 * verdween: niets in de codebase linkt er nog heen en /nfc/[tag] kent geen
	 * `randomizer`-purpose meer. Hij wordt hier meegenomen zodat er geen scherm
	 * in de oude stijl achterblijft; wegruimen is een aparte opruimbeslissing,
	 * geen herkleedwerk.
	 *
	 * PUUR PRESENTATIE — de load-functie is ongewijzigd.
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
