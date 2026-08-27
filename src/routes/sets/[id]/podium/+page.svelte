<script lang="ts">
	/**
	 * 06 · PODIUM — ONTHULLINGSPROCES (redesign fase 6).
	 *
	 * Bron: design/M!XUP Ceremonie en Randen.dc.html, scherm "06 · PODIUM —
	 * ONTHULLINGSPROCES (16:9)". Referentiemaat 1280x720.
	 *
	 * PUUR PRESENTATIE. De host-bediening (?/reveal), de recap-cascade in
	 * $lib/recap-flow en het game_sets-realtime-kanaal hieronder zijn
	 * ongewijzigd; alleen de vormgeving is nieuw. Dit scherm LEEST
	 * recap_reveal_index / recap_ranking / recap_state / battle_reveal_index en
	 * stuurt niets aan.
	 *
	 * DE 7 STAPPEN VAN DE DESIGNBRON ZIJN DE BESTAANDE CASCADE. De designbron
	 * klikt `podStep` 0..6 door; dat is exact `recap_reveal_index` bij 6 teams
	 * (0 = stand-by, 1 = 6e onthuld, … 6 = winnaar onthuld). Er is dus geen
	 * stappenteller bijgekomen — de fasen hieronder zijn afgeleid uit wat de
	 * host al schrijft, en schalen mee met team_count 2..6:
	 *
	 *   lowsCenter  — de plekken buiten het podium komen een voor een groot in
	 *                 beeld; het podium staat geblurd op de achtergrond
	 *   lowsDocked  — ze zijn klaar en dokken als compacte rij onderaan, waarna
	 *                 het podium 58px omhoog schuift en 3 -> 2 -> 1 volgt
	 *
	 * MAATVOERING: elke maat is een veelvoud van `--u`, een designpixel. Die
	 * schaalt mee met de KLEINSTE van breedte/hoogte t.o.v. 1280x720, zodat het
	 * scherm klopt op een 1920-beamer en in een laptopvenster niet uit beeld
	 * loopt. Zelfde clamp-principe als het TV-leaderboard uit fase 5.
	 */
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import BattleRankingCard from '$lib/components/game/BattleRankingCard.svelte';
	import CodeRain from '$lib/components/CodeRain.svelte';
	import { MIXUP_LOGO, RANK_ASSETS } from '$lib/mixup-assets';
	import { teamHex, teamGlow } from '$lib/team-theme';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const gs = $derived(data.gameSet);

	let revealIndex = $state(untrack(() => gs.recap_reveal_index ?? 0));
	let ranking = $state<string[]>(untrack(() => (gs.recap_ranking as string[]) ?? []));
	let recapState = $state(untrack(() => (gs.recap_state as string) ?? 'pending'));

	const totalTeams = $derived(data.rankedTeams.length);
	const allRevealed = $derived(totalTeams > 0 && revealIndex >= totalTeams);
	const phase = $derived<'pending' | 'revealing' | 'complete'>(
		recapState === 'complete' || allRevealed
			? 'complete'
			: revealIndex === 0
				? 'pending'
				: 'revealing'
	);

	// ── Battle reveal (stuk 3c) ───────────────────────────────────────────────
	// Layered IN FRONT of `phase` rather than folded into it: during battle_reveal
	// revealIndex is still 0, so `phase` reads 'pending' — the battle panel simply
	// takes the screen ahead of the Stand-by state, and every existing pedestal
	// path below is left exactly as it was.
	let battleRevealIndex = $state(untrack(() => gs.battle_reveal_index ?? 0));
	const inBattlePhase = $derived(recapState === 'battle_reveal');
	// data.battles is position-ordered; newest first so the just-revealed leads.
	const revealedBattles = $derived(data.battles.slice(0, battleRevealIndex).reverse());

	function isRevealed(teamId: string): boolean {
		if (ranking.length === 0) return false;
		const pos = ranking.indexOf(teamId);
		return pos !== -1 && pos < revealIndex;
	}

	/**
	 * TEAMFOTO LIVE (fase 7A). `data.rankedTeams` draagt photo_url al mee, maar
	 * alleen zoals het bij page-load was — dit scherm staat een hele ceremonie
	 * lang open. Een foto die tijdens de recap wordt gemaakt komt via de
	 * teams-realtime binnen en landt in deze overlay; de podiumopbouw zelf
	 * (ranking, scores, onthulvolgorde) blijft ongemoeid.
	 */
	let livePhotos = $state<Record<string, string | null>>({});

	function photoOf(team: { id: string; photo_url: string | null }): string | null {
		return team.id in livePhotos ? livePhotos[team.id]! : team.photo_url;
	}

	let animatingTeamId = $state<string | null>(null);
	let animTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`podium-${gs.id}`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'game_sets', filter: `id=eq.${gs.id}` },
				(payload) => {
					const updated = payload.new as {
						recap_reveal_index: number;
						recap_ranking: string[];
						recap_state: string;
						battle_reveal_index: number;
					};
					const newIndex = updated.recap_reveal_index ?? revealIndex;
					const newRanking = (updated.recap_ranking as string[]) ?? ranking;

					if (newIndex > revealIndex && newRanking.length > 0) {
						animatingTeamId = newRanking[newIndex - 1] ?? null;
						if (animTimer) clearTimeout(animTimer);
						animTimer = setTimeout(() => (animatingTeamId = null), 2000);
					}

					ranking = newRanking;
					revealIndex = newIndex;
					recapState = updated.recap_state ?? recapState;
					// Battle phase (stuk 3c) — same payload, separate counter.
					if (updated.battle_reveal_index !== undefined) {
						battleRevealIndex = updated.battle_reveal_index;
					}
				}
			)
			// Zelfde kanaal, tabel `teams`: een nieuwe teamfoto is een UPDATE op die
			// rij en hoeft dus geen eigen kanaal. Alleen photo_url wordt overgenomen.
			.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams' }, (payload) => {
				const row = payload.new as { id: string; photo_url: string | null };
				livePhotos = { ...livePhotos, [row.id]: row.photo_url };
			})
			.subscribe();

		return () => {
			supabaseBrowser.removeChannel(channel);
			if (animTimer) clearTimeout(animTimer);
		};
	});

	/* ══════════════════════════════════════════════════════════════════
	   PODIUMOPBOUW (designbron 06)
	   data.rankedTeams is OPLOPEND — index 0 is de laatste plek.
	══════════════════════════════════════════════════════════════════ */

	/** Blok-, glyph- en zuilmaten per podiumplek, in designpixels. */
	const PODIUM_SPEC = {
		1: {
			label: 'Top spot',
			accent: '255,45,170',
			boxW: 250,
			boxH: 150,
			glyph: 84,
			pedH: 240,
			pedW: 250,
			num: 80,
			delay: '0s'
		},
		2: {
			label: 'Runner up',
			accent: '0,229,255',
			boxW: 230,
			boxH: 110,
			glyph: 64,
			pedH: 160,
			pedW: 230,
			num: 64,
			delay: '0.3s'
		},
		3: {
			label: 'Derde plek',
			accent: '124,77,255',
			boxW: 230,
			boxH: 100,
			glyph: 58,
			pedH: 110,
			pedW: 230,
			num: 52,
			delay: '0.6s'
		}
	} as const;

	/** De zuilen van links naar rechts: runner-up, winnaar, derde. */
	const PODIUM_ORDER = [2, 1, 3] as const;

	type RankedTeam = (typeof data.rankedTeams)[number];

	function teamAtPlace(place: number): RankedTeam | null {
		return data.rankedTeams[totalTeams - place] ?? null;
	}

	const podiumSlots = $derived(
		PODIUM_ORDER.map((place) => ({
			place,
			spec: PODIUM_SPEC[place],
			team: teamAtPlace(place)
		})).filter((s) => s.team !== null)
	);

	/**
	 * De plekken buiten het podium, beste eerst (4, 5, 6) — de volgorde waarin
	 * de designbron ze toont. rankedTeams is oplopend, dus omgekeerd.
	 */
	const lowTeams = $derived(
		totalTeams > 3
			? data.rankedTeams
					.slice(0, totalTeams - 3)
					.map((team, i) => ({ team, place: totalTeams - i }))
					.reverse()
			: []
	);

	// Fasen, afgeleid uit de bestaande onthulstaat — geen eigen teller.
	const podiumStarted = $derived(podiumSlots.some((s) => s.team && isRevealed(s.team.id)));
	const lowsRevealed = $derived(lowTeams.some((l) => isRevealed(l.team.id)));
	const lowsCenter = $derived(lowsRevealed && !podiumStarted);
	const lowsDocked = $derived(lowTeams.length > 0 && podiumStarted);

	const winner = $derived(teamAtPlace(1));
	const winnerRevealed = $derived(winner !== null && isRevealed(winner.id));

	/**
	 * Scoreweergave. `setScore` staat al in `data.rankedTeams` — het is dezelfde
	 * som die de plek-afleiding voedt, dus geen extra query en geen extra bron.
	 * Zelfde nl-NL-notatie als het TV-leaderboard, zodat 1840 overal "1.840" is.
	 */
	const nl = new Intl.NumberFormat('nl-NL');

	const title = $derived(
		winnerRevealed && winner ? `${winner.display_name} pakt de kroon!` : 'Wie pakt de kroon?'
	);
	const subtitle = $derived(
		inBattlePhase
			? 'De battles gaan voor het podium'
			: winnerRevealed
				? 'Eindstand compleet — gefeliciteerd'
				: phase === 'pending'
					? 'De host onthult zo de eindstand'
					: 'De onthulling is bezig…'
	);
</script>

<svelte:head>
	<title>{data.setName} — Podium</title>
</svelte:head>

<div class="podium">
	<!-- De code-regen schildert zelf de podium-ondergrond, zodat de lagen daarop
	     screenen in plaats van op de body-achtergrond. -->
	<CodeRain class="podium-rain" />

	<div class="podium__inner">
		<header class="podium__head">
			<img src={MIXUP_LOGO} alt="M!XUP" class="podium__logo" />
			<p class="podium__set">{data.setName}</p>
			<h1 class="podium__title" class:podium__title--won={winnerRevealed}>{title}</h1>
			<p class="podium__sub">{subtitle}</p>
		</header>

		{#if inBattlePhase}
			<!-- Battle-fase: de ranglijsten per battle gaan vóór het podium.
			     Geen eigen-team-markering: dit is het gedeelde scherm. -->
			<section class="battles">
				<p class="battles__eyebrow">Ranglijst per challenge</p>
				<h2 class="battles__title">De battles</h2>

				{#if revealedBattles.length === 0}
					<div class="battles__wait">
						<span class="dot" style="--dot-c: #ff2daa; animation-delay: 0s;"></span>
						<span class="dot" style="--dot-c: #00e5ff; animation-delay: 0.35s;"></span>
						<span class="dot" style="--dot-c: #7c4dff; animation-delay: 0.7s;"></span>
					</div>
				{:else}
					<div class="battles__grid">
						{#each revealedBattles as battle (battle.challenge_id)}
							<BattleRankingCard
								title={battle.title}
								ranking={battle.ranking}
								teams={data.battleTeams}
							/>
						{/each}
					</div>
				{/if}
			</section>
		{:else}
			<div class="podium__spacer"></div>

			<!-- De plekken buiten het podium: eerst groot in het midden, daarna
			     gedokt als compacte rij onderaan. -->
			{#if lowTeams.length > 0}
				<div
					class="lows"
					class:lows--hidden={!lowsRevealed}
					class:lows--center={lowsCenter}
					class:lows--docked={lowsDocked}
				>
					{#each lowTeams as low (low.team.id)}
						{@const revealed = isRevealed(low.team.id)}
						{@const hex = teamHex(low.team.color)}
						<div
							class="low squircle"
							class:low--revealed={revealed}
							class:low--fresh={animatingTeamId === low.team.id}
							style="--team: {hex}; --team-glow: {teamGlow(low.team.color)};"
						>
							<span class="low__rank">{low.place}</span>
							<span class="low__dot"></span>
							<span class="low__name">
								{revealed ? low.team.display_name : '— nog verborgen —'}
							</span>
							<!-- Altijd in de DOM, pas zichtbaar bij de onthulling: zo houdt de
							     naamkolom dezelfde breedte en springt de rij niet op het moment
							     dat de host onthult. -->
							<span class="low__score" class:low__score--on={revealed}>
								{nl.format(low.team.setScore)}
							</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Het podium zelf: 2 | 1 | 3 -->
			{#if podiumSlots.length > 0}
				<div class="stage" class:stage--blurred={lowsCenter} class:stage--lifted={lowsDocked}>
					{#each podiumSlots as slot (slot.place)}
						{@const team = slot.team!}
						{@const spec = slot.spec}
						{@const revealed = isRevealed(team.id)}
						{@const hex = teamHex(team.color)}
						<div
							class="col"
							style="--accent: {spec.accent};
							       --team: {hex};
							       --team-glow: {teamGlow(team.color)};
							       --box-w: {spec.boxW};
							       --box-h: {spec.boxH};
							       --glyph: {spec.glyph};
							       --ped-w: {spec.pedW};
							       --ped-h: {spec.pedH};
							       --ped-num: {spec.num};
							       --pulse-delay: {spec.delay};"
						>
							{#if slot.place === 1}
								<!-- Kroonanker: breedte 0 zodat de kroon het podium niet verschuift. -->
								<div class="crown-anchor">
									<img
										src={RANK_ASSETS.crown}
										alt=""
										aria-hidden="true"
										class="crown"
										class:crown--on={winnerRevealed}
									/>
								</div>
							{/if}

							<p class="col__label">{spec.label}</p>

							<div
								class="box squircle"
								class:box--revealed={revealed}
								class:box--fresh={animatingTeamId === team.id}
							>
								{#if revealed && photoOf(team)}
									<!-- .squircle op de lagen zelf: waar corner-shape werkt is de
									     kaart een squircle, en dan moeten foto en scrim diezelfde
									     hoekvorm aannemen — anders blijft er bij de hoeken een
									     sliver teamgradient tussen kaart en foto staan. -->
									<img src={photoOf(team)} alt="" aria-hidden="true" class="box__photo squircle" />
									<span class="box__scrim squircle"></span>
								{/if}
								<span class="box__glyph">{revealed ? team.display_name : '?'}</span>
							</div>

							<div class="ped squircle">
								<span class="ped__num">{slot.place}</span>
								<!-- De zuil heeft een VASTE hoogte (--ped-h), dus de score erbij
								     verandert niets aan de podiumopbouw. Zichtbaar vanaf de
								     onthulling, net als de teamnaam in het blok erboven. -->
								<span class="ped__score" class:ped__score--on={revealed}>
									{nl.format(team.setScore)}<span class="ped__unit">ptn</span>
								</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	/* ══════════════════════════════════════════════════════════════
	   SCHAAL — referentie 1280x720
	   --u is EEN designpixel. Hij volgt de kleinste van breedte/hoogte,
	   zodat een 16:9-beamer exact klopt en een breed-maar-laag venster
	   het podium niet onder de rand duwt.
	══════════════════════════════════════════════════════════════ */
	.podium {
		--u: clamp(0.42px, min(0.0781vw, 0.1389vh), 1.6px);
		position: relative;
		height: 100svh;
		overflow: hidden;
		background: radial-gradient(110% 90% at 50% 10%, #221546 0%, #0b0b1f 60%);
		color: var(--color-mixup-paper);
		font-family: var(--font-ui);
	}

	/* De regen-wrapper is niet transparant: hij draagt de podium-gradient zelf,
	   anders screenen de lagen op de (andere) body-achtergrond.

	   Vast en op 100lvh, om dezelfde reden als .player-screen__backdrop: .podium
	   is 100svh (714px op het toestel) terwijl de viewport tot 754px groeit als
	   de browserbalk inklapt. Als kind van die doos hield de regen op bij 714 en
	   bleef er onderaan 40px staan. Fixed haalt hem uit de doos en uit de
	   overflow:hidden erboven; 100lvh dekt de grootste stand. */
	.podium :global(.podium-rain) {
		--cr-backdrop: radial-gradient(110% 90% at 50% 10%, #221546 0%, #0b0b1f 60%);
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 100vh;
		height: 100lvh;
	}

	.podium__inner {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
		box-sizing: border-box;
		/* De .podium-achtergrond loopt door tot achter de island en de
		   browserbalk (viewport-fit=cover); de inhoud blijft er met de
		   safe-area-insets vandaan. In portret zonder insets is dit exact de
		   oude 24u-padding. */
		padding: calc(24 * var(--u) + env(safe-area-inset-top, 0px))
			calc(24 * var(--u) + env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px)
			calc(24 * var(--u) + env(safe-area-inset-left, 0px));
	}

	/* ── Kop ────────────────────────────────────────────────────── */
	.podium__head {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		flex: 0 0 auto;
	}

	.podium__logo {
		width: calc(170 * var(--u));
		object-fit: contain;
	}

	.podium__set {
		margin: 0;
		font-family: var(--font-data);
		font-size: calc(13 * var(--u));
		letter-spacing: var(--tracking-mixup-wide);
		text-transform: uppercase;
		color: var(--color-mixup-dim);
	}

	.podium__title {
		margin: calc(4 * var(--u)) 0 0;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(40 * var(--u));
		line-height: 1;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 calc(30 * var(--u)) rgba(124, 77, 255, 0.9);
		transition: text-shadow 0.6s ease;
	}

	/* De winnaartitel wisselt van violette naar gouden gloed. */
	.podium__title--won {
		text-shadow:
			0 0 calc(34 * var(--u)) rgba(255, 215, 94, 0.85),
			0 0 calc(12 * var(--u)) rgba(255, 230, 0, 0.5);
	}

	.podium__sub {
		margin: calc(6 * var(--u)) 0 0;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(14 * var(--u));
		letter-spacing: var(--tracking-mixup-eyebrow);
		text-transform: uppercase;
		color: var(--color-mixup-muted);
	}

	.podium__spacer {
		flex: 1 1 auto;
	}

	/* ── Battle-fase ────────────────────────────────────────────── */
	.battles {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		padding-top: calc(18 * var(--u));
	}

	.battles__eyebrow {
		margin: 0;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(12 * var(--u));
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: #ff6fc4;
	}

	.battles__title {
		margin: calc(4 * var(--u)) 0 calc(16 * var(--u));
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(42 * var(--u));
		line-height: 0.95;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 calc(26 * var(--u)) rgba(255, 45, 170, 0.7);
	}

	.battles__grid {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: center;
		gap: calc(16 * var(--u));
		width: 100%;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: calc(24 * var(--u));
	}

	/* De battle-kaart erft de podiumschaal, zodat hij meegroeit met de beamer. */
	.battles__grid :global(.bc) {
		--bc-u: calc(1.35 * var(--u));
		width: calc(360 * var(--u));
		flex: 0 0 auto;
	}

	.battles__wait {
		display: flex;
		gap: calc(16 * var(--u));
		padding: calc(40 * var(--u)) 0;
	}

	.dot {
		width: calc(18 * var(--u));
		height: calc(18 * var(--u));
		border-radius: 50%;
		background: var(--dot-c);
		animation: pod-pulse 1.6s ease-in-out infinite;
	}

	/* ── Plekken buiten het podium ──────────────────────────────── */
	.lows {
		position: absolute;
		left: 50%;
		z-index: 6;
		display: flex;
		gap: calc(10 * var(--u));
		transition:
			top 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
			transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
			opacity 0.4s ease;
		/* Standaard: gedokt onderaan als rij. */
		top: 98.5%;
		transform: translate(-50%, -100%);
		flex-direction: row;
	}

	.lows--center {
		top: 50%;
		transform: translate(-50%, -50%) scale(1.1);
		flex-direction: column;
	}

	.lows--hidden {
		top: 50%;
		transform: translate(-50%, -50%);
		flex-direction: column;
		opacity: 0;
		pointer-events: none;
	}

	.low {
		display: flex;
		align-items: center;
		gap: calc(10 * var(--u));
		box-sizing: border-box;
		width: calc(280 * var(--u));
		height: calc(52 * var(--u));
		padding: 0 calc(14 * var(--u));
		border-radius: calc(14 * var(--u));
		background: rgba(229, 242, 255, 0.04);
		border: 1px dashed rgba(229, 242, 255, 0.2);
		backdrop-filter: blur(calc(6 * var(--u)));
		-webkit-backdrop-filter: blur(calc(6 * var(--u)));
		transition:
			width 0.5s ease,
			height 0.5s ease;
	}

	.lows--docked .low {
		width: calc(200 * var(--u));
		height: calc(36 * var(--u));
	}

	.low--revealed {
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--team) 27%, transparent) 0%,
			color-mix(in srgb, var(--team) 8%, transparent) 100%
		);
		border: 1px solid color-mix(in srgb, var(--team) 53%, transparent);
		animation: pod-reveal 0.5s ease both;
	}

	.low--fresh {
		box-shadow: 0 0 calc(28 * var(--u)) color-mix(in srgb, var(--team-glow) 45%, transparent);
	}

	.low__rank {
		width: calc(20 * var(--u));
		flex: 0 0 auto;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(26 * var(--u));
		line-height: 1;
		color: var(--color-mixup-soft);
		font-variant-numeric: tabular-nums;
	}

	.lows--docked .low__rank {
		font-size: calc(18 * var(--u));
	}

	.low__dot {
		flex: 0 0 auto;
		width: calc(12 * var(--u));
		height: calc(12 * var(--u));
		border-radius: 50%;
		border: 1px dashed rgba(229, 242, 255, 0.35);
	}

	.low--revealed .low__dot {
		background: var(--team);
		border: 1px solid rgba(229, 242, 255, 0.5);
		box-shadow: 0 0 calc(8 * var(--u)) var(--team-glow);
	}

	.low__name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(15 * var(--u));
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-mixup-dim);
	}

	.lows--docked .low__name {
		font-size: calc(12 * var(--u));
	}

	.low--revealed .low__name {
		color: var(--color-mixup-paper);
	}

	/* Score per rij, zelfde gele display-cijfers als op de zuil en het
	   TV-leaderboard. Staat altijd in de DOM zodat de naamkolom niet van
	   breedte verspringt bij de onthulling. */
	.low__score {
		flex: 0 0 auto;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(20 * var(--u));
		line-height: 1;
		color: var(--color-mixup-yellow);
		text-shadow: 0 0 calc(14 * var(--u)) rgba(255, 230, 0, 0.35);
		font-variant-numeric: tabular-nums;
		visibility: hidden;
		opacity: 0;
		transition: opacity 0.4s ease 0.1s;
	}

	.lows--docked .low__score {
		font-size: calc(15 * var(--u));
	}

	.low__score--on {
		visibility: visible;
		opacity: 1;
	}

	/* ── Het podium ─────────────────────────────────────────────── */
	.stage {
		display: flex;
		align-items: flex-end;
		gap: calc(28 * var(--u));
		flex: 0 0 auto;
		transition:
			filter 0.5s ease,
			transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.stage--blurred {
		filter: blur(calc(10 * var(--u)));
	}

	.stage--lifted {
		transform: translateY(calc(-58 * var(--u)));
	}

	.col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: calc(8 * var(--u));
	}

	.col__label {
		margin: 0;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(14 * var(--u));
		letter-spacing: var(--tracking-mixup-eyebrow);
		text-transform: uppercase;
		color: var(--color-mixup-muted);
	}

	/* Breedte 0 + overflow zichtbaar: de kroon hangt boven de Top Spot zonder
	   de kolombreedte te beinvloeden, zodat het podium niet verschuift. */
	.crown-anchor {
		position: relative;
		width: 0;
		height: calc(141 * var(--u));
		overflow: visible;
		pointer-events: none;
	}

	.crown {
		position: absolute;
		left: 50%;
		bottom: calc(-43 * var(--u));
		height: calc(166 * var(--u));
		max-width: none;
		object-fit: contain;
		filter: drop-shadow(0 0 calc(22 * var(--u)) rgba(255, 215, 94, 0.65));
		opacity: 0;
		transform: translateX(-50%) scale(0.2);
		transition:
			opacity 0.5s ease,
			transform 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.3);
	}

	.crown--on {
		opacity: 1;
		transform: translateX(-50%) scale(1);
	}

	/* Teamblok — dashed en pulserend tot de host het onthult.
	 *
	 * GEEN overflow: hidden. Op iOS Safari 18.7 klipte die langs een RECHTE rand
	 * in plaats van langs de afgeronde. De foto en de scrim ronden zichzelf nu af
	 * met --box-r-inner; in Playwright-WebKit levert dat exact hetzelfde hoekpixel
	 * op als de oude clip, en zonder die radius lekt de foto vierkant over de hoek.
	 *
	 * De .squircle op foto en scrim (zie de markup) is voor browsers waar
	 * corner-shape WEL werkt — daar blijft anders een sliver teamgradient in de
	 * hoek staan. Op iOS 18.7 doet die klasse niets: corner-shape wordt daar
	 * gemeten niet ondersteund, dus de squircle-hoekvorm komt er niet tot stand.
	 *
	 * LET OP: de teamgekleurde band die de aanleiding was voor dit onderzoek is
	 * hiermee NIET aantoonbaar opgelost. Die band zit op de plek-reveal op het
	 * SPELERSCHERM, niet op dit TV-podium. */
	.box {
		--box-r: calc(22 * var(--u));
		/* De binnenrand van de rand: waar de foto en de scrim (inset: 0) staan. */
		--box-r-inner: calc(var(--box-r) - 2 * var(--u));
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: calc(var(--box-w) * var(--u));
		height: calc(var(--box-h) * var(--u));
		border-radius: var(--box-r);
		border: calc(2 * var(--u)) dashed rgba(var(--accent), 0.45);
	}

	.box--revealed {
		border: calc(2 * var(--u)) solid var(--team);
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--team) 25%, transparent) 0%,
			color-mix(in srgb, var(--team) 8%, transparent) 100%
		);
		box-shadow: 0 0 calc(44 * var(--u)) color-mix(in srgb, var(--team-glow) 40%, transparent);
		animation: pod-reveal 0.7s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}

	/* Net onthuld: de gloed staat 2 seconden hoger (realtime-gestuurd). */
	.box--fresh {
		box-shadow: 0 0 calc(80 * var(--u)) color-mix(in srgb, var(--team-glow) 70%, transparent);
	}

	.box__photo {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: var(--box-r-inner);
	}

	/* Houdt de teamnaam leesbaar bovenop een teamfoto. */
	.box__scrim {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(11, 11, 31, 0.2) 0%, rgba(11, 11, 31, 0.75) 100%);
		border-radius: var(--box-r-inner);
	}

	/* Zonder de overflow-clip van .box is dit het enige wat een extreem lange
	   teamnaam nog binnen de kaart houdt. */
	.box__glyph {
		position: relative;
		max-width: 100%;
		overflow: hidden;
		padding: 0 calc(10 * var(--u));
		text-align: center;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(var(--glyph) * var(--u));
		line-height: 1;
		color: rgba(var(--accent), 0.55);
		animation: pod-pulse 1.6s var(--pulse-delay) infinite;
	}

	.box--revealed .box__glyph {
		font-size: calc(var(--glyph) * 0.52 * var(--u));
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 calc(24 * var(--u)) var(--team-glow);
		animation: none;
	}

	/* Zuil — teamkleur zodra onthuld, anders de plek-accentkleur. */
	.ped {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		gap: calc(2 * var(--u));
		box-sizing: border-box;
		width: calc(var(--ped-w) * var(--u));
		height: calc(var(--ped-h) * var(--u));
		padding-top: calc(12 * var(--u));
		border-radius: calc(18 * var(--u)) calc(18 * var(--u)) 0 0;
		background: linear-gradient(
			180deg,
			rgba(var(--accent), 0.14) 0%,
			rgba(var(--accent), 0.03) 100%
		);
		border: 1px solid rgba(var(--accent), 0.3);
		border-bottom: none;
	}

	.ped__num {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(var(--ped-num) * var(--u));
		line-height: 1;
		color: rgba(var(--accent), 0.35);
	}

	/* De score op de zuil. Gele cijfers in de display-stijl van het
	   TV-leaderboard, zodat een score er overal in het redesign hetzelfde
	   uitziet. Onzichtbaar tot de host de plek onthult — de ruimte is dan al
	   gereserveerd, dus er verschuift niets op het onthulmoment. */
	.ped__score {
		display: flex;
		align-items: baseline;
		gap: calc(4 * var(--u));
		font-family: var(--font-display);
		font-weight: 900;
		font-size: calc(var(--ped-num) * 0.4 * var(--u));
		line-height: 1;
		color: var(--color-mixup-yellow);
		text-shadow: 0 0 calc(16 * var(--u)) rgba(255, 230, 0, 0.4);
		font-variant-numeric: tabular-nums;
		visibility: hidden;
		opacity: 0;
		transform: scale(0.8);
		transition:
			opacity 0.45s ease 0.15s,
			transform 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.3) 0.15s;
	}

	/* Iets na de revealPop van het teamblok, zodat de score de plek volgt
	   in plaats van hem aan te kondigen. */
	.ped__score--on {
		visibility: visible;
		opacity: 1;
		transform: scale(1);
	}

	.ped__unit {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: calc(var(--ped-num) * 0.17 * var(--u));
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--color-mixup-muted);
		text-shadow: none;
	}

	/* ── Animaties (designbron: revealPop / pulse) ──────────────── */
	@keyframes pod-reveal {
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

	@keyframes pod-pulse {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.box--revealed,
		.low--revealed,
		.box__glyph,
		.dot {
			animation: none;
		}
		.lows,
		.stage,
		.crown,
		.low,
		.ped__score,
		.low__score {
			transition: none;
		}
	}
</style>
