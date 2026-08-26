<script lang="ts">
	/**
	 * 10 · WACHTSCHERM — "DE STAND WORDT ONTHULD" (redesign fase 5).
	 *
	 * Bron: design/M!XUP Player Flow v2.dc.html, scherm "10 · WACHTSCHERM — LIVE
	 * ONTHULLING", plus de post-reveal-state uit "02 · WACHTSCHERM — POST-REVEAL"
	 * (design/M!XUP Ceremonie en Randen.dc.html).
	 *
	 * PUUR PRESENTATIE. Dit scherm LEEST de host-gestuurde onthul-staat die er al
	 * was — `game_sets.recap_state`, `recap_ranking`, `recap_reveal_index` en
	 * `battle_reveal_index` — over hetzelfde, ongewijzigde realtime-kanaal. Er is
	 * geen nieuw kanaal, geen nieuwe kolom en geen nieuwe overgang bijgekomen; de
	 * battle-fase (stuk 3c) en de redirect naar /play/thanks staan er nog exact zo.
	 *
	 * Wat de onthulling stuurt: `recap_ranking` is OPLOPEND opgeslagen (laatste
	 * plek eerst) en `recap_reveal_index` telt hoeveel plekken de host onthuld
	 * heeft. De lijst hieronder staat AFLOPEND (plek 1 bovenaan), dus plek p is
	 * onthuld zodra p > totaal - onthuld. Precies de conditie uit de designbron.
	 */
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import BattleRankingCard from '$lib/components/game/BattleRankingCard.svelte';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { MIXUP_LOGO } from '$lib/mixup-assets';
	import { teamHex, teamOnColor } from '$lib/team-theme';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let revealIndex = $state(untrack(() => data.recapRevealIndex));
	let ranking = $state<string[]>(untrack(() => data.recapRanking));

	// Whether this player's team has been revealed yet
	const myRankIndex = data.playerRankIndex; // 0-based, 0 = last place
	const revealed = $derived(myRankIndex !== -1 && ranking.length > 0 && myRankIndex < revealIndex);
	// Also handle: the ranking may not be set yet, but revealIndex advances — detect via index comparison
	const revealedByIndex = $derived(myRankIndex !== -1 && revealIndex > myRankIndex);

	let showRevealCard = $state(false);
	let revealCardDismissed = $state(false);

	const shouldShowReveal = $derived((revealed || revealedByIndex) && !revealCardDismissed);

	// ── Battle reveal (stuk 3c) ───────────────────────────────────────────────
	// Rides the SAME game_sets channel as the team cascade below — recap_state and
	// battle_reveal_index live on that row, so the existing subscription already
	// delivers them; no second channel. Kept strictly separate from revealIndex /
	// recapRanking: the team-reveal reaction above is untouched.
	let recapState = $state(untrack(() => data.recapState));
	let battleRevealIndex = $state(untrack(() => data.battleRevealIndex));

	const inBattlePhase = $derived(recapState === 'battle_reveal');
	// data.battles is already position-ordered; battle N is visible once
	// battleRevealIndex passes it. Newest first so the just-revealed battle leads.
	const revealedBattles = $derived(data.battles.slice(0, battleRevealIndex).reverse());

	// ── De onthullijst (scherm 10) ────────────────────────────────────────────
	// data.standings staat AFLOPEND: index 0 = plek 1. Hoeveel er onthuld zijn
	// komt uitsluitend uit recap_reveal_index, dat de host live opschuift.
	const totalPlaces = data.standings.length;
	const revealedCount = $derived(Math.min(totalPlaces, Math.max(0, revealIndex)));
	/** De laagste nog-onthulde plek — die kreeg zojuist de beurt. */
	const freshPlace = $derived(totalPlaces - revealedCount + 1);

	const revealStatus = $derived(
		revealedCount === 0
			? 'HET GROTE SCHERM START DE ONTHULLING…'
			: revealedCount < totalPlaces
				? `ZOJUIST ONTHULD · PLEK ${freshPlace} — VOLGENDE: PLEK ${freshPlace - 1}`
				: 'ALLES ONTHULD · JULLIE REVEAL KOMT NU'
	);

	const teamColor = $derived(teamHex(data.team.color));
	const onTeamColor = $derived(teamOnColor(data.team.color));

	const nl = new Intl.NumberFormat('nl-NL');

	$effect(() => {
		if (shouldShowReveal) showRevealCard = true;
	});

	// ── "Terwijl je wacht" ────────────────────────────────────────────────────
	let carouselIdx = $state(0);
	const carouselLen = data.carouselChallenges.length;

	const variantLabel: Record<string, string> = {
		standard: 'Standard',
		anthem: 'Anthem',
		label: 'Label',
		mashup: 'Mashup',
		fragments: 'Fragments',
		effects: 'Effects',
		normal: 'Normal',
		vocal: 'Vocal',
		kick: 'Kick',
		battle: 'Battle'
	};

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`waiting-set-${data.setId}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'game_sets',
					filter: `id=eq.${data.setId}`
				},
				(payload) => {
					const updated = payload.new as {
						status: string;
						recap_state: string;
						recap_ranking: string[];
						recap_reveal_index: number;
						battle_reveal_index: number;
					};

					if (updated.recap_ranking) ranking = updated.recap_ranking as string[];
					if (updated.recap_reveal_index !== undefined) revealIndex = updated.recap_reveal_index;

					// Battle phase (stuk 3c) — same payload, separate counter.
					if (updated.recap_state) recapState = updated.recap_state;
					if (updated.battle_reveal_index !== undefined) {
						battleRevealIndex = updated.battle_reveal_index;
					}

					if (updated.recap_state === 'complete') {
						window.location.href = `/play/thanks?set_id=${data.setId}`;
					}
				}
			)
			.subscribe();

		let timer: ReturnType<typeof setInterval> | undefined;
		if (carouselLen > 1) {
			timer = setInterval(() => {
				carouselIdx = (carouselIdx + 1) % carouselLen;
			}, 6000);
		}

		return () => {
			supabaseBrowser.removeChannel(channel);
			if (timer !== undefined) clearInterval(timer);
		};
	});
</script>

<svelte:head>
	<title>De stand wordt onthuld — M!XUP</title>
</svelte:head>

<!-- ─── Jouw eigen onthulling: volledig scherm in de teamkleur ─── -->
{#if showRevealCard && !revealCardDismissed}
	<div class="own-reveal" style="--team: {teamColor}; --on-team: {onTeamColor};">
		<span class="own-reveal__ring"></span>
		<span class="own-reveal__ring" style="animation-delay: 0.85s;"></span>

		<div class="own-reveal__body">
			<div class="own-reveal__eyebrow">JULLIE PLEK</div>
			<div class="own-reveal__place">
				{data.playerPosition !== null ? data.playerPosition : '—'}
			</div>
			<div class="own-reveal__team">{data.team.display_name}</div>
			<div class="own-reveal__score">{nl.format(data.playerSetScore)} PUNTEN</div>

			{#if data.teammates.length > 0}
				<div class="own-reveal__mates">
					{#each data.teammates as p (p.id)}
						{#if p.photo_url}
							<img src={p.photo_url} alt={p.display_name} class="own-reveal__mate" />
						{:else}
							<span class="own-reveal__mate own-reveal__mate--initial">
								{p.display_name.charAt(0).toUpperCase()}
							</span>
						{/if}
					{/each}
				</div>
			{/if}

			<button
				type="button"
				class="own-reveal__btn squircle"
				onclick={() => (revealCardDismissed = true)}
			>
				BEKIJK ALLE TEAMS
			</button>
		</div>
	</div>
{/if}

<!-- ─── Wachtscherm ─── -->
<PlayerScreen rain corners={0.5} fitViewport class="items-center px-5 text-center">
	<div class="wait">
		<div class="wait__badge">
			<img src={MIXUP_LOGO} alt="M!XUP" />
		</div>

		{#if inBattlePhase}
			<!-- Battle-fase: de ranglijsten per battle gaan vóór het podium. -->
			<h1 class="wait__title">Battles worden beslist</h1>
			<p class="wait__lede">
				{revealedBattles.length === 0
					? 'De host onthult zo de battles'
					: 'Wie scoorde het hoogst op deze challenge?'}
			</p>
		{:else if revealCardDismissed}
			<!-- Post-reveal (ceremoniebron 02): jullie plek staat vast. -->
			<div class="wait__pill" style="--team: {teamColor}; --on-team: {onTeamColor};">
				<span class="wait__pill-place">
					#{data.playerPosition !== null ? data.playerPosition : '—'}
				</span>
				<span class="wait__pill-team">
					{data.team.display_name} · {nl.format(data.playerSetScore)} PTN
				</span>
			</div>
			<h1 class="wait__title">Jullie plek staat vast</h1>
			<p class="wait__lede">
				De ceremonie loopt nog — kijk naar het grote scherm voor de rest van de onthulling.
			</p>
		{:else}
			<h1 class="wait__title">De stand wordt onthuld</h1>
		{/if}

		<!-- ── Battle-kaarten (stuk 3c) ──
		     Alleen tijdens battle_reveal; zodra de host overdraagt aan 'revealing'
		     neemt de onthullijst hieronder het over, exact zoals voorheen. -->
		{#if inBattlePhase && revealedBattles.length > 0}
			<div class="wait__battles">
				{#each revealedBattles as battle (battle.challenge_id)}
					<BattleRankingCard
						title={battle.title}
						ranking={battle.ranking}
						teams={data.battleTeams}
						highlightTeamId={data.team.id}
						compact
					/>
				{/each}
			</div>
		{/if}

		<!-- ── De onthullijst: nu op het grote scherm ── -->
		{#if !inBattlePhase && totalPlaces > 0}
			<div class="reveal-card squircle">
				<div class="reveal-card__head">
					<span class="reveal-card__label">NU OP HET GROTE SCHERM</span>
					<span class="reveal-card__live">
						<span class="reveal-card__live-dot"></span>
						<span>LIVE</span>
					</span>
				</div>

				<div class="reveal-card__rows">
					{#each data.standings as row, i (row.id)}
						{@const place = i + 1}
						{@const isOpen = place > totalPlaces - revealedCount}
						{@const isFresh = place === freshPlace && revealedCount > 0}
						<div
							class="rv squircle"
							class:rv--open={isOpen}
							class:rv--fresh={isFresh}
							class:rv--mine={isOpen && row.id === data.team.id}
						>
							<span class="rv__rank">{place}</span>
							<span class="rv__dot" style="--dot: {isOpen ? teamHex(row.color) : '#3A3F5C'};"
							></span>
							<span class="rv__name">{isOpen ? row.display_name : '???'}</span>
							<span class="rv__score">{isOpen ? nl.format(row.score) : '—'}</span>
						</div>
					{/each}
				</div>

				<div class="reveal-card__status">{revealStatus}</div>
			</div>
		{/if}

		<!-- ── Terwijl je wacht ──
		     Verborgen tijdens de battle-fase: dit is vulling, en de battles zijn
		     op dat moment juist het ding om naar te kijken. -->
		{#if carouselLen > 0 && !inBattlePhase && data.carouselChallenges[carouselIdx]}
			{@const item = data.carouselChallenges[carouselIdx]}
			<div class="while squircle">
				<div class="while__head">
					<span class="while__label">TERWIJL JE WACHT</span>
					<span class="while__count">{carouselIdx + 1}/{carouselLen}</span>
				</div>
				<div class="while__title">{item.title}</div>
				<div class="while__sub">{variantLabel[item.variant] ?? item.variant}</div>
				{#if carouselLen > 1}
					<div class="while__dots">
						{#each data.carouselChallenges as _, i (i)}
							<button
								type="button"
								class="while__dot"
								class:while__dot--on={i === carouselIdx}
								aria-label="Toon challenge {i + 1}"
								onclick={() => (carouselIdx = i)}
							></button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</PlayerScreen>

<style>
	/* ══════════════════════════════════════════════════════════════
	   WACHTSCHERM
	══════════════════════════════════════════════════════════════ */
	.wait {
		display: flex;
		flex: 1 1 auto;
		min-height: 0;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		width: 100%;
		overflow-y: auto;
	}

	.wait__badge {
		width: 78px;
		height: 78px;
		border-radius: 50%;
		border: 3px solid var(--color-mixup-cyan);
		box-shadow:
			0 0 34px rgba(0, 229, 255, 0.5),
			inset 0 0 22px rgba(124, 77, 255, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		animation: wait-breathe 2.6s ease-in-out infinite;
		flex: 0 0 auto;
	}

	.wait__badge img {
		width: 60px;
		object-fit: contain;
	}

	.wait__title {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 34px;
		line-height: 0.95;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 26px rgba(124, 77, 255, 0.85);
	}

	.wait__lede {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 13px;
		line-height: 1.5;
		color: var(--color-mixup-muted);
	}

	.wait__pill {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		border-radius: 99px;
		background: var(--team);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
	}

	.wait__pill-place {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 26px;
		line-height: 1;
		color: var(--on-team);
	}

	.wait__pill-team {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 12px;
		letter-spacing: 0.14em;
		color: var(--on-team);
		opacity: 0.85;
	}

	.wait__battles {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 10px;
		text-align: left;
	}

	/* ══════════════════════════════════════════════════════════════
	   ONTHULLIJST
	══════════════════════════════════════════════════════════════ */
	.reveal-card {
		width: 100%;
		background: linear-gradient(135deg, rgba(229, 242, 255, 0.1), rgba(229, 242, 255, 0.03));
		border: 1px solid rgba(229, 242, 255, 0.22);
		border-radius: var(--radius-mixup-lg);
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		text-align: left;
		flex: 0 0 auto;
	}

	.reveal-card__head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.reveal-card__label {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 10px;
		letter-spacing: 0.16em;
		color: var(--color-mixup-cyan);
	}

	.reveal-card__live {
		display: flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-data);
		font-size: 10px;
		color: var(--color-mixup-muted);
	}

	.reveal-card__live-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-mixup-magenta);
		animation: wait-pulse 1.2s infinite;
	}

	.reveal-card__rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.reveal-card__status {
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.1em;
		color: var(--color-mixup-dim);
	}

	/* ── Eén plek in de lijst ── */
	.rv {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: var(--radius-mixup-xs);
		background: rgba(11, 11, 31, 0.45);
		border: 1px solid rgba(229, 242, 255, 0.1);
		/* Nog niet onthuld: rustig ademen tot de host hem opendraait. */
		animation: wait-pulse 2.2s ease-in-out infinite;
	}

	.rv--open {
		background: rgba(229, 242, 255, 0.06);
		animation: none;
	}

	.rv--fresh {
		border-color: rgba(0, 229, 255, 0.65);
		box-shadow: 0 0 18px rgba(0, 229, 255, 0.25);
		animation: wait-reveal-row 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}

	/* Je eigen team blijft herkenbaar zodra het onthuld is. */
	.rv--mine {
		border-color: rgba(229, 242, 255, 0.34);
	}

	.rv__rank {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 18px;
		width: 22px;
		flex: 0 0 auto;
		color: #3e466b;
	}

	.rv--open .rv__rank {
		color: var(--color-mixup-paper);
	}

	.rv__dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--dot);
		border: 1px solid rgba(229, 242, 255, 0.5);
		flex: 0 0 auto;
	}

	.rv--open .rv__dot {
		box-shadow: 0 0 8px var(--dot);
	}

	.rv__name {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 12px;
		letter-spacing: 0.06em;
		color: #48507a;
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rv--open .rv__name {
		color: var(--color-mixup-paper);
	}

	.rv__score {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 19px;
		color: #3e466b;
		flex: 0 0 auto;
		font-variant-numeric: tabular-nums;
	}

	.rv--open .rv__score {
		color: var(--color-mixup-yellow);
	}

	/* ══════════════════════════════════════════════════════════════
	   TERWIJL JE WACHT
	══════════════════════════════════════════════════════════════ */
	.while {
		width: 100%;
		background: linear-gradient(135deg, rgba(229, 242, 255, 0.08), rgba(229, 242, 255, 0.02));
		border: 1px solid rgba(229, 242, 255, 0.18);
		border-radius: var(--radius-mixup-card);
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 5px;
		text-align: left;
		flex: 0 0 auto;
	}

	.while__head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.while__label {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 10px;
		letter-spacing: 0.16em;
		color: var(--color-mixup-yellow);
	}

	.while__count {
		font-family: var(--font-data);
		font-size: 10px;
		color: var(--color-mixup-dim);
	}

	.while__title {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 22px;
		line-height: 1.05;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
	}

	.while__sub {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 12px;
		color: var(--color-mixup-muted);
	}

	.while__dots {
		display: flex;
		gap: 5px;
		margin-top: 4px;
	}

	.while__dot {
		width: 6px;
		height: 6px;
		border-radius: 99px;
		border: none;
		padding: 0;
		background: rgba(229, 242, 255, 0.2);
		transition: width 0.3s ease;
		cursor: pointer;
	}

	.while__dot--on {
		width: 18px;
		background: var(--color-mixup-cyan);
	}

	/* ══════════════════════════════════════════════════════════════
	   EIGEN ONTHULLING (volledig scherm)
	══════════════════════════════════════════════════════════════ */
	.own-reveal {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: radial-gradient(120% 80% at 50% 22%, var(--team) 0%, #06060d 96%);
	}

	.own-reveal__ring {
		position: absolute;
		left: calc(50% - 100px);
		top: calc(50% - 100px);
		width: 200px;
		height: 200px;
		border-radius: 50%;
		border: 2px solid rgba(255, 230, 0, 0.32);
		animation: wait-spark 2.2s ease-out infinite;
		pointer-events: none;
	}

	.own-reveal__body {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 0 28px;
		text-align: center;
		animation: wait-reveal-pop 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
	}

	.own-reveal__eyebrow {
		font-family: var(--font-data);
		font-size: 11px;
		letter-spacing: 0.34em;
		color: rgba(255, 255, 255, 0.75);
	}

	.own-reveal__place {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 124px;
		line-height: 0.86;
		color: #ffffff;
		text-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
	}

	.own-reveal__team {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 40px;
		line-height: 0.92;
		text-transform: uppercase;
		color: #ffffff;
		text-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
	}

	.own-reveal__score {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 28px;
		color: #ffffff;
		text-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
	}

	.own-reveal__mates {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 10px;
	}

	.own-reveal__mate {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		object-fit: cover;
		background: rgba(229, 242, 255, 0.12);
		border: 1.5px solid rgba(229, 242, 255, 0.5);
	}

	.own-reveal__mate--initial {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 11px;
		color: var(--color-mixup-paper);
	}

	.own-reveal__btn {
		margin-top: 22px;
		height: 52px;
		padding: 0 26px;
		border-radius: 24px;
		background: rgba(11, 11, 31, 0.35);
		border: 1px solid rgba(255, 255, 255, 0.55);
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 15px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #ffffff;
		cursor: pointer;
	}

	/* ══════════════════════════════════════════════════════════════
	   MOTION
	══════════════════════════════════════════════════════════════ */
	@keyframes wait-breathe {
		0%,
		100% {
			opacity: 0.5;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.06);
		}
	}

	@keyframes wait-pulse {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}

	@keyframes wait-reveal-row {
		0% {
			transform: translateX(-14px) scale(0.96);
			opacity: 0;
		}
		100% {
			transform: translateX(0) scale(1);
			opacity: 1;
		}
	}

	@keyframes wait-reveal-pop {
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

	@keyframes wait-spark {
		0% {
			transform: scale(0.25);
			opacity: 0.75;
		}
		100% {
			transform: scale(4);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.wait__badge,
		.reveal-card__live-dot,
		.rv,
		.rv--fresh,
		.own-reveal__ring,
		.own-reveal__body {
			animation: none;
		}
		.rv {
			opacity: 1;
		}
	}
</style>
