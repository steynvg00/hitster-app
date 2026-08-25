<script lang="ts">
	/**
	 * 03b · TUSSENSCHERM — "Dit spel is voorbij", NFC-variant (redesign fase 6).
	 *
	 * Zelfde scherm als /sets/[id]/over, bereikt via /nfc/randomize/[set_id].
	 * Zie de zusterroute /nfc/game-in-progress: die keten is een restant van de
	 * verdwenen NFC-randomizer en wordt hier alleen meegenomen zodat er geen
	 * scherm in de oude stijl achterblijft.
	 *
	 * PUUR PRESENTATIE — de load-functie is ongewijzigd. Deze variant kent geen
	 * podium-link: de load geeft alleen de setnaam terug, en daar iets aan
	 * toevoegen zou load-logica zijn.
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
	<a href="/leaderboard" class="mixup-btn mixup-btn-secondary">Bekijk de live stand</a>
	<a href="/" class="mixup-btn mixup-btn-ghost">Terug naar start</a>
</Interstitial>
