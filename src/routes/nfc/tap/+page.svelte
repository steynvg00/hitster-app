<script lang="ts">
	/**
	 * 04 · NFC-TAP-MOMENT — weergaveroute (redesign fase 6).
	 *
	 * Bron: design/M!XUP Ceremonie en Randen.dc.html, scherm "04 NFC-tap".
	 *
	 * BEWUST NIET AANGESLOTEN op de tap-keten. /nfc/[tag] is een `+server.ts`
	 * die meteen redirect; daar een scherm tussen schuiven betekent de redirect
	 * vervangen door een pagina die zelf doorstuurt — nieuwe navigatielogica en
	 * een tragere tap. Dat is een aparte beslissing, geen herkleedwerk.
	 *
	 * Deze route rendert het scherm zoals de designbron het toont, zodat het
	 * bekeken en getoetst kan worden. Geen +page.server.ts, geen DB: de
	 * teamkleur komt uit `?team=`, de teksten uit `?title=` / `?lede=`.
	 */
	import { page } from '$app/state';
	import NfcTapSplash from '$lib/components/game/NfcTapSplash.svelte';

	const color = $derived(page.url.searchParams.get('team'));
	const title = $derived(page.url.searchParams.get('title') ?? undefined);
	const lede = $derived(page.url.searchParams.get('lede') ?? undefined);
</script>

<svelte:head>
	<title>Tap gelukt — M!XUP</title>
</svelte:head>

<NfcTapSplash {color} {title} {lede} />
