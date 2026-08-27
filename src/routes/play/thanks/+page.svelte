<script lang="ts">
	/**
	 * 11H · EINDSTAND PER PLEK (redesign fase 5).
	 *
	 * Bron: design/M!XUP Player Flow v2.dc.html, schermen "11H · EINDSTAND —
	 * PLEK 1 (KROON) / PLEK 2 (ZILVER) / PLEK 3 (BRONS) / PLEK 4 EN LAGER".
	 *
	 * Eén kaart, vier metaalvarianten. De plek-4-kaart is de TEMPLATE voor élke
	 * positie onder 3 — alleen het nummer, de tag en de achterstand wisselen; de
	 * vormgeving niet. Dat zit in $lib/standings (rankTier / rankTag / rankDelta),
	 * zodat er hier geen vier losgeknipte varianten staan.
	 *
	 * PUUR PRESENTATIE. De scores komen uit dezelfde submissions-aggregatie die de
	 * pagina al deed; de eindplek is daaruit AFGELEID (hoeveel teams staan strikt
	 * boven ons, + 1). Er wordt niets geschreven en er is geen realtime.
	 *
	 * De code-regen ligt ACHTER de kaart en krijgt --cr-backdrop met de
	 * teamkleur-radial mee: de regen-wrapper is niet transparant, dus zonder die
	 * variabele zou hij op de standaard paginagradient screenen in plaats van op
	 * de achtergrond van dit scherm.
	 */
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { getVariantIcon, getVariantColor } from '$lib/variants';
	import { teamHex } from '$lib/team-theme';
	import { RANK_ASSETS } from '$lib/mixup-assets';
	import { rankTier, rankTag, rankDelta } from '$lib/standings';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const hex = $derived(teamHex(data.team.color));
	const tier = $derived(rankTier(data.place));
	const tag = $derived(rankTag(data.place));
	const delta = $derived(rankDelta(data.place, data.teamSetScore, data.descendingScores));

	/** Paginagrond én code-regen-ondergrond: de teamkleur die naar ink wegvalt. */
	const pageBackdrop = $derived(`radial-gradient(120% 80% at 50% 22%, ${hex}66 0%, #06060D 72%)`);

	const nl = new Intl.NumberFormat('nl-NL');

	/** Initialen voor de crew-rij op de kaart. */
	const initials = $derived(
		data.teammates.map((p) => ({
			id: p.id,
			ini: p.display_name.trim().slice(0, 2).toUpperCase()
		}))
	);

	// Beste challenge van de avond (hoogste positieve score).
	const bestChallenge = $derived(
		data.challengeResults
			.filter((ch) => ch.score !== null && ch.score > 0)
			.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null
	);

	const challengesPlayed = $derived(data.challengeResults.filter((ch) => ch.score !== null).length);
</script>

<svelte:head>
	<title>Eindstand — {data.setName}</title>
</svelte:head>

<div
	class="finale"
	style="--team: {hex};
	       --accent: {tier.accent};
	       --metal-face: {tier.face};
	       --metal-shadow: {tier.shadow};
	       --foil: {tier.foil};
	       --page-bg: {pageBackdrop};
	       --cr-backdrop: {pageBackdrop};"
>
	<PlayerScreen rain class="px-6">
		<!-- ─── De eindstandkaart ─── -->
		<section class="hero">
			<div class="card squircle">
				<div class="card__halo"></div>

				{#if tier.supreme}
					<!-- Alleen plek 1: het Supreme-watermerk, binnen de kaartradius geklemd. -->
					<div class="card__clip squircle">
						<img src={RANK_ASSETS.supreme} alt="" class="card__supreme" />
					</div>
				{/if}

				<!-- Teamkleurbalk bovenop de kaart. -->
				<div class="card__team-bar"></div>

				<img
					src={tier.asset}
					alt=""
					class="card__medal"
					style="width: {tier.assetWidth}px;
					       height: {tier.assetHeight}px;
					       top: {tier.assetTop}px;
					       margin-left: {-tier.assetWidth / 2}px;"
				/>

				<div class="card__tag">{tag}</div>
				<div class="card__rank">{data.place}</div>
				<div class="card__team">{data.team.display_name}</div>
				<div class="card__score">{nl.format(data.teamSetScore)} PUNTEN</div>
				{#if delta}
					<div class="card__delta">{delta}</div>
				{/if}

				{#if initials.length > 0}
					<div class="card__crew">
						{#each initials as p (p.id)}
							<span class="card__mate">{p.ini}</span>
						{/each}
					</div>
				{/if}

				<div class="card__foil"></div>
			</div>

			<div class="hero__foot">
				<a href="/" class="replay squircle">SPEEL OPNIEUW</a>
				{#if data.challengeResults.length > 0}
					<span class="hero__hint">JULLIE AVOND ↓</span>
				{/if}
			</div>
		</section>

		<!-- ─── Terugblik: wat jullie deze set speelden ─── -->
		{#if data.challengeResults.length > 0}
			<section class="recap">
				<div class="recap__stats">
					<div class="stat squircle">
						<span class="stat__value">{challengesPlayed}</span>
						<span class="stat__label">GESPEELD</span>
					</div>
					<div class="stat squircle">
						<span class="stat__value"
							>{data.place}<span class="stat__of">/{data.totalTeams}</span></span
						>
						<span class="stat__label">EINDPLEK</span>
					</div>
					<div class="stat squircle">
						<span class="stat__value stat__value--score">{nl.format(data.totalScore)}</span>
						<span class="stat__label">PUNTEN</span>
					</div>
				</div>

				{#if bestChallenge}
					<div class="best squircle">
						<span class="best__label">BESTE MOMENT</span>
						<span class="best__title">{bestChallenge.title}</span>
						<span class="best__score">+{bestChallenge.score}</span>
					</div>
				{/if}

				<h2 class="recap__heading">JULLIE CHALLENGES</h2>
				<div class="recap__list">
					{#each data.challengeResults as ch, i (i)}
						{@const VariantIcon = getVariantIcon(ch.variant)}
						{@const variantColor = getVariantColor(ch.variant)}
						<div class="ch squircle">
							<span class="ch__icon {variantColor}"><VariantIcon size={14} /></span>
							<span class="ch__body">
								<span class="ch__title">{ch.title}</span>
								<span class="ch__variant">{ch.variant}</span>
							</span>
							<span class="ch__score" class:ch__score--zero={!ch.score}>
								{ch.score !== null ? `${ch.score > 0 ? '+' : ''}${ch.score}` : '—'}
							</span>
						</div>
					{/each}
				</div>

				<p class="recap__outro">Bedankt voor het spelen. Tot de volgende.</p>
			</section>
		{/if}
	</PlayerScreen>
</div>

<style>
	/* De paginagrond van dit scherm wint van de standaard paginagradient. Hij
	   gaat via --screen-bg: die property erft door tot in de vaste
	   achtergrondlaag van PlayerScreen, en dat is de laag die tot de schermrand
	   reikt. Stond hij op .player-screen, dan hield de grond op bij 100svh —
	   zie de laagmeting in PlayerScreen.svelte. De code-regen erbovenop krijgt
	   dezelfde grond via --cr-backdrop. */
	.finale {
		background: var(--page-bg);
		--screen-bg: var(--page-bg);
	}

	.hero {
		flex: 1 0 auto;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 22px;
		/* Ruimte bovenin zodat de kroon (top -130) niet tegen de notch loopt. */
		padding-top: 96px;
	}

	/* ══════════════════════════════════════════════════════════════
	   DE KAART
	══════════════════════════════════════════════════════════════ */
	.card {
		position: relative;
		background: linear-gradient(
			165deg,
			color-mix(in srgb, var(--team) 85%, transparent) 0%,
			rgba(10, 9, 18, 0.97) 108%
		);
		border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
		border-radius: var(--radius-mixup-modal);
		box-shadow:
			0 0 34px color-mix(in srgb, var(--accent) 35%, transparent),
			0 0 96px color-mix(in srgb, var(--accent) 19%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.16),
			inset 0 0 46px color-mix(in srgb, var(--accent) 13%, transparent);
		padding: 104px 22px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		text-align: center;
		animation: ticket-in 0.8s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}

	.card__halo {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 155%;
		height: 150%;
		transform: translate(-50%, -50%);
		pointer-events: none;
		background: radial-gradient(
			closest-side,
			color-mix(in srgb, var(--accent) 24%, transparent) 0%,
			color-mix(in srgb, var(--accent) 7%, transparent) 46%,
			transparent 72%
		);
	}

	.card__clip {
		position: absolute;
		inset: 0;
		overflow: hidden;
		border-radius: var(--radius-mixup-modal);
		pointer-events: none;
	}

	.card__supreme {
		position: absolute;
		left: 50%;
		top: 54%;
		width: 96%;
		transform: translate(-50%, -50%);
		object-fit: contain;
		mix-blend-mode: multiply;
		filter: blur(2px);
		opacity: 0.85;
		pointer-events: none;
	}

	.card__team-bar {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 6px;
		background: var(--team);
		border-radius: var(--radius-mixup-modal) var(--radius-mixup-modal) 0 0;
	}

	.card__medal {
		position: absolute;
		left: 50%;
		object-fit: contain;
		pointer-events: none;
		filter: drop-shadow(0 10px 26px rgba(0, 0, 0, 0.55))
			drop-shadow(0 0 28px color-mix(in srgb, var(--accent) 50%, transparent));
	}

	.card__tag {
		position: relative;
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.24em;
		color: var(--accent);
	}

	.card__rank {
		position: relative;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 124px;
		line-height: 0.86;
		color: var(--metal-face);
		text-shadow:
			0 2px 0 var(--metal-shadow),
			0 10px 30px rgba(0, 0, 0, 0.55);
	}

	.card__team {
		position: relative;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 40px;
		line-height: 0.92;
		text-transform: uppercase;
		color: #ffffff;
		text-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
	}

	.card__score {
		position: relative;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 28px;
		color: #ffffff;
		text-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
	}

	.card__delta {
		position: relative;
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.16em;
		color: rgba(229, 242, 255, 0.8);
	}

	.card__crew {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 6px;
	}

	.card__mate {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: rgba(229, 242, 255, 0.12);
		border: 1.5px solid rgba(229, 242, 255, 0.5);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 11px;
		color: var(--color-mixup-paper);
	}

	.card__foil {
		position: relative;
		width: 100%;
		height: 10px;
		margin-top: 12px;
		border-radius: 99px;
		background: var(--foil);
	}

	/* ══════════════════════════════════════════════════════════════
	   VOET VAN HET ARTBOARD
	══════════════════════════════════════════════════════════════ */
	.hero__foot {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}

	.replay {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 52px;
		padding: 0 28px;
		border-radius: 24px;
		background: rgba(229, 242, 255, 0.06);
		border: 1px solid rgba(229, 242, 255, 0.2);
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 15px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-mixup-muted);
		text-decoration: none;
	}

	.hero__hint {
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.2em;
		color: var(--color-mixup-dim);
	}

	/* ══════════════════════════════════════════════════════════════
	   TERUGBLIK
	══════════════════════════════════════════════════════════════ */
	.recap {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 56px 0 8px;
	}

	.recap__stats {
		display: flex;
		gap: 10px;
	}

	.stat {
		flex: 1 1 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 12px 6px;
		border-radius: var(--radius-mixup-sm);
		background: rgba(229, 242, 255, 0.04);
		border: 1px solid rgba(229, 242, 255, 0.12);
	}

	.stat__value {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 30px;
		line-height: 1;
		color: var(--color-mixup-paper);
	}

	.stat__value--score {
		color: var(--color-mixup-yellow);
	}

	.stat__of {
		font-size: 16px;
		color: var(--color-mixup-muted);
	}

	.stat__label {
		font-family: var(--font-data);
		font-size: 9px;
		letter-spacing: 0.16em;
		color: var(--color-mixup-dim);
	}

	.best {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		border-radius: var(--radius-mixup-card);
		background: rgba(255, 45, 170, 0.07);
		border: 1px solid rgba(255, 45, 170, 0.22);
	}

	.best__label {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 10px;
		letter-spacing: 0.16em;
		color: var(--color-mixup-magenta);
		flex: 0 0 auto;
	}

	.best__title {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 13px;
		color: var(--color-mixup-paper);
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.best__score {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 20px;
		color: var(--color-mixup-magenta);
		flex: 0 0 auto;
	}

	.recap__heading {
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.22em;
		color: var(--color-mixup-dim);
	}

	.recap__list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.ch {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: var(--radius-mixup-sm);
		background: rgba(229, 242, 255, 0.04);
		border: 1px solid rgba(229, 242, 255, 0.12);
	}

	.ch__icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 10px;
		flex: 0 0 auto;
	}

	.ch__body {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1 1 auto;
	}

	.ch__title {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 13px;
		color: var(--color-mixup-paper);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ch__variant {
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.1em;
		color: var(--color-mixup-dim);
		text-transform: uppercase;
	}

	.ch__score {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 20px;
		color: var(--color-mixup-yellow);
		flex: 0 0 auto;
		font-variant-numeric: tabular-nums;
	}

	.ch__score--zero {
		color: var(--color-mixup-dim);
	}

	.recap__outro {
		margin-top: 6px;
		text-align: center;
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 12px;
		font-style: italic;
		color: var(--color-mixup-muted);
	}

	/* ══════════════════════════════════════════════════════════════
	   MOTION
	══════════════════════════════════════════════════════════════ */
	@keyframes ticket-in {
		0% {
			transform: translateY(70px) rotate(-3deg);
			opacity: 0;
		}
		70% {
			transform: translateY(-6px) rotate(1deg);
			opacity: 1;
		}
		100% {
			transform: translateY(0) rotate(0deg);
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card {
			animation: none;
		}
	}
</style>
