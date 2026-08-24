<script lang="ts">
	/**
	 * 03c · TUSSENSCHERM — "Geen spel actief" (redesign fase 6).
	 *
	 * Bron: design/M!XUP Ceremonie en Randen.dc.html, scherm "03c Geen spel
	 * actief". Telefoon-weg-kristal met magenta glow, kop 40px, ghost-knop.
	 *
	 * PUUR PRESENTATIE — dit scherm heeft geen load-functie en krijgt er ook
	 * geen; het is het eindpunt van een redirect uit /nfc/[tag].
	 *
	 * AFWIJKING VAN DE DESIGNBRON: die zet er "PROBEER OPNIEUW" onder. Deze
	 * pagina kent de gescande tag niet (de redirect laat hem niet achter), dus
	 * een herhaalpoging zou alleen dit scherm opnieuw tonen. De knop gaat
	 * daarom terug naar start.
	 */
	import Interstitial from '$lib/components/game/Interstitial.svelte';
	import { ICON_ASSETS } from '$lib/mixup-assets';
</script>

<svelte:head>
	<title>Geen spel actief — M!XUP</title>
</svelte:head>

<Interstitial
	icon={ICON_ASSETS.noPhone}
	glow="rgba(255, 45, 170, 0.35)"
	title="Geen spel actief"
	lede="Dit kaartje hoort bij een spel dat nog niet gestart is. Vraag de host wanneer het losgaat."
>
	<a href="/" class="mixup-btn mixup-btn-ghost">Terug naar start</a>
</Interstitial>
