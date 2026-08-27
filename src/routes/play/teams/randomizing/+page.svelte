<script lang="ts">
	/**
	 * 3A · RANDOMIZER (redesign fase 2) — mobiel, referentie 390x844.
	 *
	 * Drie fases, zelfde timing als voorheen: rollen (0-1.8s) → reveal (1.8s) →
	 * done (3.6s, knop verschijnt). De dobbelsteen rolt in 0.7s; bij de reveal
	 * verschijnt de teamkleur-cirkel met splash-mixup.mp4 erachter
	 * (mix-blend screen, breedte tot de schermranden, z-index onder de tekst).
	 *
	 * GEEN code-regen op dit scherm — de designbron heeft die hier niet, en de
	 * ondergrond is de teamkleur-radial die de video moet laten doorkomen.
	 *
	 * Data-flow ONGEWIJZIGD: het team komt uit de bestaande ?team=-parameter
	 * die de server valideert; deze pagina schrijft niets.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { ICON_ASSETS, SPLASH_VIDEO } from '$lib/mixup-assets';
	import { teamHex } from '$lib/team-theme';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let phase = $state<'rolling' | 'reveal' | 'done'>('rolling');
	let splashEl = $state<HTMLVideoElement | null>(null);
	/** Opruimer van startSplash(): stopt de herhaalpogingen bij unmount. */
	let stopSplash: (() => void) | null = null;

	/**
	 * "Deze speler heeft de reveal van DIT team al gezien."
	 *
	 * localStorage en niet sessionStorage: de vlag moet een tabsluiting en een
	 * herstart overleven, anders speelt de reveal opnieuw af voor iemand die
	 * zijn team allang kent. De waarde is de teamkleur, niet een boolean — komt
	 * de speler na een reset in een ander team, dan wijkt de waarde af en is de
	 * reveal terecht weer nieuw.
	 */
	const SEEN_KEY = 'mixup_team_reveal_seen';

	function alreadySeen(): boolean {
		try {
			return localStorage.getItem(SEEN_KEY) === data.team;
		} catch {
			// Private mode / geblokkeerde opslag: dan maar één keer te vaak spelen.
			return false;
		}
	}

	function markSeen() {
		try {
			localStorage.setItem(SEEN_KEY, data.team);
		} catch {
			/* zie alreadySeen() */
		}
	}

	/**
	 * Naar de team-console, en dit scherm uit de history-stack halen.
	 *
	 * replaceState is de kern van de terugswipe-fix: de randomizer stond als
	 * echte entry direct onder /team, dus één back-stap te veel (of een
	 * bfcache-restore van die entry) zette de speler terug in de reveal van een
	 * team dat hij allang kende. Wat er niet in de stack staat, kan de
	 * back-gesture ook niet raken.
	 */
	function toTeam() {
		markSeen();
		void goto('/team', { replaceState: true });
	}

	const hex = $derived(teamHex(data.team));
	const revealed = $derived(phase === 'reveal' || phase === 'done');
	/** Achtergrond wisselt bij de reveal naar een radial in de teamkleur. */
	const backdrop = $derived(
		revealed ? `radial-gradient(120% 90% at 50% 30%, ${hex}66 0%, #0B0B1F 72%)` : null
	);

	onMount(() => {
		// Kent deze speler zijn team al, dan is er niets te onthullen: meteen door
		// naar de console, zónder history-entry. Dit dekt ook het handmatig
		// terugtypen van de URL en een join-redirect na een tabsluiting.
		if (alreadySeen()) {
			void goto('/team', { replaceState: true });
			return;
		}

		const t1 = setTimeout(() => {
			phase = 'reveal';
			markSeen();
			stopSplash = startSplash();
		}, 1800);
		const t2 = setTimeout(() => (phase = 'done'), 3600);

		// Een bfcache-restore draait onMount niet opnieuw; zonder dit kon de oude
		// randomizer-entry als bevroren reveal terugkomen.
		const onPageShow = (e: PageTransitionEvent) => {
			if (e.persisted && alreadySeen()) void goto('/team', { replaceState: true });
		};
		window.addEventListener('pageshow', onPageShow);

		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
			stopSplash?.();
			window.removeEventListener('pageshow', onPageShow);
		};
	});

	/**
	 * De splash starten, en blijven proberen tot het lukt.
	 *
	 * Waarom een herhaalpoging en niet één `canplay`-listener: gemeten in WebKit
	 * op iPhone-formaat vuurt `canplay` op ~170 ms, terwijl deze functie pas op
	 * ~2266 ms draait (onMount + de 1800 ms rol-fase). De oude terugval
	 *
	 *     el.play().catch(() => el.addEventListener('canplay', …, { once: true }))
	 *
	 * hing dus aan een gebeurtenis die al 2,1 s eerder was gevallen en nooit meer
	 * komt — een element vuurt `canplay` alleen opnieuw als readyState eerst
	 * onder HAVE_FUTURE_DATA zakt. Eén geweigerde play() maakte de video daarmee
	 * permanent dood: hij bleef zichtbaar op frame 0 staan. Dát is de reden dat
	 * de splash "soms niet speelde" en dat de bandbreedtefix er niets aan
	 * veranderde — de video was allang binnen, hij mocht alleen niet starten.
	 *
	 * iOS weigert play() zonder gebruikersgebaar onder andere in
	 * energiebesparingsmodus en bij Safari > Autoplay: Nooit. Daar helpt geen
	 * enkele hoeveelheid buffer tegen; alleen opnieuw proberen, en meeliften op
	 * het eerste echte aanraakgebaar, dat élke blokkade opheft.
	 *
	 * muted/loop/playsInline worden hier nog eens als PROPERTY gezet: de
	 * attributen staan in de HTML, maar iOS beoordeelt de autoplay-voorwaarden
	 * op de property-stand op het moment van play().
	 */
	function startSplash(): () => void {
		if (!splashEl) return () => {};
		// Vaste, niet-nullbare verwijzing: de closures hieronder overleven latere
		// wijzigingen van de $state-binding niet als ze splashEl blijven lezen.
		const el: HTMLVideoElement = splashEl;

		el.muted = true;
		el.loop = true;
		el.playsInline = true;

		let done = false;

		function attempt() {
			if (done) return;
			if (!el.paused && el.currentTime > 0) return stop();
			void el.play().then(() => {
				if (!el.paused) stop();
			}, ignoreRejection);
		}

		// De afwijzing is verwacht (zie boven) en wordt door de volgende poging
		// afgehandeld; hem opslokken voorkomt een unhandled rejection in de console.
		function ignoreRejection() {}

		const retry = setInterval(attempt, 250);
		// Na de reveal-animatie heeft doorproberen geen zin meer: het scherm is dan
		// weg of de speler heeft allang doorgeklikt.
		const giveUp = setTimeout(() => stop(), 8000);

		function stop() {
			done = true;
			clearInterval(retry);
			clearTimeout(giveUp);
			window.removeEventListener('pointerdown', attempt);
		}

		window.addEventListener('pointerdown', attempt);
		attempt();
		return stop;
	}
</script>

<svelte:head>
	<title>Je team — M!XUP</title>
</svelte:head>

<!--
	.randomizer: vaste viewporthoogte (100dvh) zodat dit scherm nooit scrolt.
	De 190px-spacer boven de cirkel mag krimpen (shrink) — op een iPhone SE
	(375x667) is dat de enige ruimte die weg kan zonder de knop uit beeld te
	duwen.
-->
<div class="randomizer">
	<PlayerScreen {backdrop} class="items-center px-7 text-center">
		<div class="h-[190px] shrink"></div>

		<div class="relative flex h-[190px] w-[190px] flex-none items-center justify-center">
			<!-- De splashvideo staat er vanaf het begin (preload="auto"), alleen
			     onzichtbaar tijdens het rollen — zie startSplash() voor waarom. -->
			<video
				bind:this={splashEl}
				src={SPLASH_VIDEO}
				preload="auto"
				muted
				loop
				playsinline
				aria-hidden="true"
				class="splash"
				class:splash--waiting={!revealed}
			></video>
			{#if phase === 'rolling'}
				<img
					src={ICON_ASSETS.dice}
					alt=""
					class="dice h-40 w-40 object-contain"
					style="filter: drop-shadow(0 14px 34px rgba(255,45,170,0.5));"
				/>
			{:else}
				<div class="reveal-circle" style="--tc: {hex};"></div>
			{/if}
		</div>

		<div class="relative z-10 flex w-full flex-1 flex-col items-center gap-4 pt-16">
			{#if phase === 'rolling'}
				<div
					class="font-display text-[38px] font-black text-mixup-paper uppercase"
					style="text-shadow: 0 0 26px rgba(124,77,255,0.85);"
				>
					We zoeken je team…
				</div>
				<div class="text-[13px] font-medium text-mixup-muted">Het lot beslist. Even geduld.</div>
			{:else}
				<div class="text-[13px] font-extrabold tracking-[0.3em] text-mixup-paper">
					JIJ SPEELT VOOR
				</div>
				<div
					class="font-display text-[58px] leading-[0.9] font-black text-mixup-paper uppercase"
					style="text-shadow: 0 0 40px {hex};"
				>
					{data.label}
				</div>
			{/if}

			<div class="flex h-14 flex-none items-center justify-center">
				{#if phase === 'done'}
					<!-- Geen <a>: de navigatie moet dit scherm VERVANGEN in de history,
					     niet er een entry bovenop leggen. -->
					<button type="button" onclick={toTeam} class="go-btn squircle">NAAR JE TEAM →</button>
				{/if}
			</div>
		</div>
	</PlayerScreen>
</div>

<style>
	/* Viewport-vast: dvh volgt de iOS-adresbalk (svh/vh niet), dus geen
	   scrollruimte als de balk inklapt of uitklapt. Alleen hier, via de
	   .randomizer-wrapper — PlayerScreen zelf blijft min-height:100svh. */
	.randomizer :global(.player-screen) {
		height: 100dvh;
		min-height: 100dvh;
		max-height: 100dvh;
	}

	.dice {
		animation: dice-roll 0.7s cubic-bezier(0.45, 0, 0.55, 1) infinite;
	}

	@keyframes dice-roll {
		0% {
			transform: rotate(0deg) scale(1);
		}
		50% {
			transform: rotate(180deg) scale(1.15);
		}
		100% {
			transform: rotate(360deg) scale(1);
		}
	}

	/* Splash vult de volle schermbreedte en zit ACHTER cirkel én tekst. */
	.splash {
		position: absolute;
		left: 50%;
		/* Designformule: top = 95 + splashY - (h - 240) / 2, met splashY = -123 en
		   h = breedte * 16/9. Bij 390px breed geeft dat -254.7px. */
		top: calc(92px - 100vw * 8 / 9);
		width: 100vw;
		max-width: 100vw;
		height: calc(100vw * 16 / 9);
		margin-left: -50vw;
		object-fit: contain;
		mix-blend-mode: screen;
		pointer-events: none;
		opacity: 0.95;
		filter: contrast(1.4) brightness(1.05);
		z-index: 0;
	}

	/* Tijdens het rollen staat de video er al (te bufferen) maar mag hij niet te
	   zien zijn. opacity, geen display:none of visibility:hidden — Safari mag een
	   verborgen video de decoder afpakken, en dan is het bufferen voor niets. */
	.splash--waiting {
		opacity: 0;
	}

	.reveal-circle {
		position: relative;
		z-index: 1;
		width: 170px;
		height: 170px;
		border-radius: 50%;
		background: var(--tc);
		border: 3px solid rgba(255, 255, 255, 0.5);
		box-shadow:
			0 0 70px color-mix(in srgb, var(--tc) 67%, transparent),
			0 0 150px color-mix(in srgb, var(--tc) 33%, transparent),
			inset 0 -14px 40px rgba(0, 0, 0, 0.25);
		animation: reveal-pop 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}

	@keyframes reveal-pop {
		0% {
			transform: scale(0.2) rotate(-8deg);
			opacity: 0;
		}
		55% {
			transform: scale(1.12) rotate(2deg);
			opacity: 1;
		}
		100% {
			transform: scale(1) rotate(0deg);
			opacity: 1;
		}
	}

	.go-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 54px;
		padding: 0 28px;
		border-radius: 26px;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 16px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		background: linear-gradient(90deg, #ffe600, #ff7f11);
		color: #1a1400;
		box-shadow: 0 10px 30px rgba(255, 127, 17, 0.35);
		animation: reveal-pop 0.5s ease both;
		/* Was een <a>; als <button> heeft hij deze twee nog nodig. */
		border: 0;
		cursor: pointer;
	}
</style>
