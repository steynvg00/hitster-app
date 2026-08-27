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
		/**
		 * Kristal-hoeken tonen. Was een opacity (0.35-0.5, en 0 om ze uit te
		 * zetten); dat is nu een aan/uit-schakelaar, want de doorzichtigheid
		 * hoort in het asset te zitten en niet in een tweede laag eroverheen.
		 * Zie .player-screen__corners hieronder.
		 */
		corners?: boolean;
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
		/**
		 * Het scherm groeit mee met zijn inhoud en de PAGINA scrolt als geheel —
		 * het tegenovergestelde van `fitViewport`.
		 *
		 * Nodig zodra een scherm `position: sticky` gebruikt: de schil heeft van
		 * huis uit `overflow: hidden`, en dat maakt hem het scrollvoorouder van
		 * alles erin. Sticky elementen plakken dan aan een doos die zelf niet
		 * scrolt en bewegen dus nooit. Deze stand zet daar `overflow-x: clip` voor
		 * in de plaats: clip klemt de breedte af zonder scrollvoorouder te worden,
		 * dus sticky blijft werken.
		 *
		 * De kristal-hoeken worden hier `fixed`: bij een pagina die twee schermen
		 * hoog is moet die rand een rand van het VENSTER blijven, niet uitgerekt
		 * worden over de hele hoogte.
		 */
		pageScroll?: boolean;
		class?: string;
		children?: Snippet;
	};

	let {
		rain = false,
		layers = 3,
		corners = true,
		backdrop = null,
		fitViewport = false,
		pageScroll = false,
		class: className = '',
		children
	}: Props = $props();
</script>

<div
	class="player-screen"
	class:player-screen--fit={fitViewport}
	class:player-screen--page-scroll={pageScroll}
>
	<!--
		Alle achtergrondlagen zitten in ÉÉN vaste laag, buiten de doos van
		.player-screen. Zie de CSS hieronder voor het waarom; de volgorde binnen
		de laag is ongewijzigd: regen onderop, dan de optionele kleurtint, dan de
		kristal-hoeken.
	-->
	<div class="player-screen__backdrop" aria-hidden="true">
		{#if rain}
			<CodeRain {layers} />
		{/if}
		{#if backdrop}
			<div class="player-screen__tint" style="background: {backdrop};"></div>
		{/if}
		{#if corners}
			<img
				src={OVERLAY_ASSETS.frameCorners.linksboven}
				alt=""
				class="player-screen__corner player-screen__corner--lb"
			/>
			<img
				src={OVERLAY_ASSETS.frameCorners.rechtsboven}
				alt=""
				class="player-screen__corner player-screen__corner--rb"
			/>
			<img
				src={OVERLAY_ASSETS.frameCorners.linksonder}
				alt=""
				class="player-screen__corner player-screen__corner--lo"
			/>
			<img
				src={OVERLAY_ASSETS.frameCorners.rechtsonder}
				alt=""
				class="player-screen__corner player-screen__corner--ro"
			/>
		{/if}
	</div>
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

	/* Zie de prop-documentatie: clip in plaats van hidden, zodat sticky werkt.
	   `overflow-y: visible` naast `overflow-x: clip` is de enige combinatie die
	   de ene as laat klemmen en de andere echt vrij laat. */
	.player-screen--page-scroll {
		overflow-x: clip;
		overflow-y: visible;
	}

	/* ── De vaste achtergrondlaag ───────────────────────────────────────────
	   De regen en de hoeken stonden als `absolute; inset: 0` BINNEN
	   .player-screen. Ze konden daardoor per constructie nooit buiten die doos
	   schilderen — en die doos is min-height:100svh.

	   Toestelmeting (iOS Safari 18.7, iPhone 402px breed):
	     100svh = 714px      klein  — browserbalk uitgeklapt
	     100lvh = 754px      groot  — browserbalk ingeklapt
	   Verschil 40px, en dat is exact de strook die zwart bleef.

	   `position: fixed` haalt de laag uit .player-screen: hij maat tegen het
	   initial containing block en wordt niet geknipt door de overflow:hidden
	   hierboven, en hij SCHUIFT NIET MEE bij scrollen. Dat laatste was het
	   tweede deel van de klacht: naar beneden scrollen haalde wel de onderkant
	   maar verloor de bovenkant, omdat de laag met de pagina meebewoog.

	   Maar fixed alleen is NIET genoeg. Het initial containing block is per
	   specificatie zo hoog als de KLEINE viewport — dus `inset: 0` levert
	   opnieuw 714px en dezelfde strook van 40px. Vandaar de expliciete
	   `height: 100lvh`: de grootste stand die de viewport ooit aanneemt, zodat
	   de laag in beide standen van de browserbalk tot de rand loopt.

	   Geen negatieve env(safe-area-inset-*)-offsets: op dit toestel zijn alle
	   vier de insets gemeten op 0px, dus die zouden hier niets doen. Niet
	   toegevoegd omdat het niet te verifiëren is.

	   `100vh` staat ervoor als terugval voor browsers zonder lvh-ondersteuning;
	   op iOS is 100vh van oudsher al de grote viewport, dus dat is precies de
	   juiste terugval. */
	.player-screen__backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 100vh;
		height: 100lvh;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;

		/* ── De GROND hoort hier, niet op .player-screen ────────────────────
		   Dit is wat er na #106 nog ontbrak. Die commit verhuisde de OVERLAYS
		   (regen, kleurtint, kristal-hoeken) naar deze laag en gaf hem
		   100lvh — maar de paginagradient bleef achter op .player-screen, via
		   de utility `mixup-page`. Die doos is min-height:100svh.

		   Laagmeting op de echte pagina's (WebKit, viewport 402x754, met
		   100svh opgelegd op 714 — de toestelmaten uit #106):

		     .player-screen__backdrop  fixed, 0→754, background rgba(0,0,0,0)
		     .player-screen            0→714, gradient
		     schildert op y=740:       ALLEEN html

		   De laag die tot de rand reikt was dus leeg, en de laag met de
		   gradient reikte 40px te kort. In de strook ertussen bleef alleen
		   het html-achtergrondje over — een ANDERE doos, met
		   background-attachment: fixed, precies de eigenschap waar iOS Safari
		   het slechtst mee omgaat. Dat is de strook die zwart bleef.

		   Dat verklaart ook waarom de diagnosepagina wél werkte: daar wás de
		   geteste laag de achtergrond. Hier was hij doorzichtig.

		   --screen-bg laat een scherm zijn eigen grond meegeven; die custom
		   property erft gewoon door vanaf een wrapper om <PlayerScreen> heen
		   (zie /play/thanks). Zonder override: de standaard paginagradient. */
		background: var(--screen-bg, var(--gradient-mixup-page));
	}

	.player-screen__tint {
		position: absolute;
		inset: 0;
	}

	/* ── Vier losse hoeken ──────────────────────────────────────────────────
	   Was één afbeelding van 768x1376 met alle vier de hoeken erin, met
	   `inset: 0` en `object-fit: cover` over het hele vlak uitgerekt. Twee
	   problemen: 86,40% van dat bestand was alfa 0 (lege ruimte die elk scherm
	   meelaadde), en de hoeken waren niet afzonderlijk te plaatsen — cover
	   schaalt op de langste as en snijdt de rest weg, dus op een smal scherm
	   schoven ze naar buiten.

	   Nu is elke hoek een eigen bestand, strak bijgesneden, verankerd in zijn
	   eigen SCHERMhoek. De breedte staat in procenten van de laag en komt uit
	   de bron: 265/768 = 34,51% voor de bovenhoeken, 335/768 = 43,62% en
	   336/768 = 43,75% voor de onderhoeken. De hoogte volgt uit de eigen
	   beeldverhouding, dus ze vervormen op geen enkel schermformaat.

	   De inzetten komen ook uit de bron: de bovenhoeken stonden 11px van de
	   rand (1,43% breed, 0,80% hoog), de onderhoeken sloten aan op de rand.

	   GEEN opacity. Die stond ooit op 0.35-0.5 en zette de hele afbeelding
	   door, inclusief de volledig dekkende delen — daardoor was de code-regen
	   dwars door het kristal heen te zien. De doorzichtigheid zit in het
	   alfakanaal. */
	.player-screen__corner {
		position: absolute;
		height: auto;
	}

	.player-screen__corner--lb {
		top: 0.8%;
		left: 1.43%;
		width: 34.51%;
	}

	.player-screen__corner--rb {
		top: 0.8%;
		right: 1.43%;
		width: 34.51%;
	}

	.player-screen__corner--lo {
		bottom: 0;
		left: 0;
		width: 43.62%;
	}

	.player-screen__corner--ro {
		bottom: 0;
		right: 0;
		width: 43.75%;
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
