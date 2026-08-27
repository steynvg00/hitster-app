<script lang="ts">
	/**
	 * 05 · TV-LEADERBOARD — "TUSSENSTAND" (redesign fase 5).
	 *
	 * Bron: design/M!XUP Ceremonie en Randen.dc.html, scherm "05 · TV-LEADERBOARD
	 * — BEAMER (16:9)". Referentiemaat 1280x720; alle maten schalen mee met de
	 * viewportbreedte (clamp) zodat het scherm net zo goed op een 1920-beamer als
	 * in een laptopvenster klopt.
	 *
	 * PUUR PRESENTATIE. Het teams-kanaal, de refetch en het game_sets-kanaal zijn
	 * ongewijzigd; alleen de vormgeving is nieuw. De kroon is de score-gedreven
	 * weergave uit fase 2 (zie $lib/standings) — hier met het kroon-asset in
	 * plaats van het glyph, precies zoals de TV-designbron hem toont.
	 */
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import CodeRain from '$lib/components/CodeRain.svelte';
	import { MIXUP_LOGO, RANK_ASSETS } from '$lib/mixup-assets';
	import { teamHex } from '$lib/team-theme';
	import { topScoreOf, wearsCrown, livePlaceLabel } from '$lib/standings';
	import type { PageData } from './$types';

	type TeamRow = (typeof data.teams)[number];

	let { data }: { data: PageData } = $props();
	let teams = $state<TeamRow[]>([...data.teams]);

	/** Noemer voor de balkbreedtes — ondergrens 20, dus NIET bruikbaar als topscore. */
	let barMax = $derived(Math.max(...teams.map((t) => t.score), 20));
	let topScore = $derived(topScoreOf(teams));

	// Rangwissel-indicatoren (3 seconden zichtbaar na een wissel).
	let prevRanks = $state<Map<string, number>>(new Map(teams.map((t, i) => [t.id, i])));
	let rankDeltas = $state<Map<string, number>>(new Map());

	function updateRanks(newTeams: TeamRow[]) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const deltas = new Map<string, number>();
		newTeams.forEach((t, newIdx) => {
			const prev = prevRanks.get(t.id) ?? newIdx;
			if (prev !== newIdx) deltas.set(t.id, prev - newIdx);
		});
		rankDeltas = deltas;
		prevRanks = new Map(newTeams.map((t, i) => [t.id, i]));
		teams = newTeams;
		setTimeout(() => {
			rankDeltas = new Map();
		}, 3000);
	}

	const nl = new Intl.NumberFormat('nl-NL');

	function streakOf(team: TeamRow): number {
		return (team as unknown as { current_streak?: number }).current_streak ?? 0;
	}

	onMount(() => {
		const channel = supabaseBrowser
			.channel('tv-leaderboard')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, async () => {
				const { data: updated } = await supabaseBrowser
					.from('teams')
					.select('id, color, display_name, score, current_streak, photo_url')
					.order('score', { ascending: false });
				if (updated) updateRanks(updated as TeamRow[]);
			})
			.subscribe();

		let setChannel: ReturnType<typeof supabaseBrowser.channel> | null = null;
		if (data.activeSetId) {
			setChannel = supabaseBrowser
				.channel(`tv-leaderboard-set-${data.activeSetId}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'game_sets',
						filter: `id=eq.${data.activeSetId}`
					},
					() => {
						// Dit kanaal bestond alleen om crown_holder_team_id te volgen. De kroon
						// volgt nu de score (zie topScore hierboven), die via het teams-kanaal
						// binnenkomt. De subscriptie blijft bewust staan zodat het TV-scherm
						// zijn game_sets-kanaal houdt; er is nu niets te doen bij een update.
					}
				)
				.subscribe();
		}

		return () => {
			supabaseBrowser.removeChannel(channel);
			if (setChannel) supabaseBrowser.removeChannel(setChannel);
		};
	});
</script>

<svelte:head>
	<title>Tussenstand — M!XUP</title>
</svelte:head>

<div class="tv">
	<!-- De code-regen schildert zelf de TV-ondergrond, zodat de lagen daarop
	     screenen in plaats van op de body-achtergrond. -->
	<CodeRain opacity={0.92} class="tv-rain" />

	<div class="tv__inner">
		<img src={MIXUP_LOGO} alt="M!XUP" class="tv__logo" />
		<h1 class="tv__title">Tussenstand</h1>

		<div class="tv__rows">
			{#each teams as team, i (team.id)}
				{@const hex = teamHex(team.color)}
				{@const delta = rankDeltas.get(team.id) ?? 0}
				{@const streak = streakOf(team)}
				<div class="tv-row">
					<span class="tv-row__rank">{livePlaceLabel(team.score, i + 1)}</span>
					<span class="tv-row__dot" style="--dot: {hex};"></span>
					<span class="tv-row__name">
						{team.display_name}
						{#if streak >= 2}
							<span class="tv-row__streak" title="{streak} op rij">🔥</span>
						{/if}
						{#if delta !== 0}
							<span class="tv-row__move" style="color: {delta > 0 ? '#2BD97A' : '#FF2DAA'};">
								{delta > 0 ? '▲' : '▼'}
							</span>
						{/if}
					</span>
					<span class="tv-row__track">
						<span
							class="tv-row__fill"
							style="width: {Math.max(1, (team.score / barMax) * 100)}%;
							       background: linear-gradient(90deg, {hex}, rgba(229,242,255,0.65));"
						></span>
					</span>
					<span class="tv-row__score">{nl.format(team.score)}</span>
					<span class="tv-row__crown">
						{#if wearsCrown(team.score, topScore)}
							<img src={RANK_ASSETS.crown} alt="Koploper" />
						{/if}
					</span>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	/* Referentie 1280x720. Elke maat is clamp(min, <design>/1280 * 100vw, max),
	   zodat de verhoudingen van de designbron op elke beamerresolutie kloppen. */
	.tv {
		position: relative;
		min-height: 100svh;
		overflow: hidden;
		background: radial-gradient(110% 90% at 50% 10%, #221546 0%, #0b0b1f 60%);
		color: var(--color-mixup-paper);
		font-family: var(--font-ui);
	}

	/* De code-regen-wrapper is niet transparant: hij draagt de TV-gradient zelf,
	   anders screenen de lagen op de (andere) body-achtergrond. */
	.tv :global(.tv-rain) {
		--cr-backdrop: radial-gradient(110% 90% at 50% 10%, #221546 0%, #0b0b1f 60%);
		/* Zelfde behandeling als .player-screen__backdrop en .podium-rain. Op een
		   beamer verandert er niets (daar is 100svh gelijk aan 100lvh); het houdt
		   de drie achtergrondlagen van de app op één regel als dit scherm op een
		   telefoon wordt geopend. */
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 100vh;
		height: 100lvh;
	}

	.tv__inner {
		position: relative;
		z-index: 1;
		min-height: 100svh;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: clamp(20px, 2.65vw, 52px) clamp(24px, 9.4vw, 180px) clamp(24px, 3.1vw, 60px);
	}

	.tv__logo {
		width: clamp(110px, 15.6vw, 300px);
		object-fit: contain;
	}

	.tv__title {
		margin-top: clamp(16px, 2.65vw, 52px);
		font-family: var(--font-display);
		font-weight: 900;
		font-size: clamp(30px, 3.75vw, 72px);
		line-height: 1;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 30px rgba(124, 77, 255, 0.9);
	}

	.tv__rows {
		flex: 1 1 auto;
		width: 100%;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: clamp(8px, 1.1vw, 21px);
		margin-top: clamp(6px, 0.8vw, 15px);
	}

	.tv-row {
		display: flex;
		align-items: center;
		gap: clamp(8px, 1.56vw, 30px);
	}

	.tv-row__rank {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: clamp(22px, 2.65vw, 51px);
		color: var(--color-mixup-muted);
		width: clamp(26px, 3.1vw, 60px);
		text-align: right;
		flex: 0 0 auto;
	}

	.tv-row__dot {
		width: clamp(9px, 1.1vw, 21px);
		height: clamp(9px, 1.1vw, 21px);
		border-radius: 50%;
		background: var(--dot);
		border: 1px solid rgba(229, 242, 255, 0.5);
		box-shadow: 0 0 8px var(--dot);
		flex: 0 0 auto;
	}

	.tv-row__name {
		display: flex;
		align-items: center;
		gap: 0.4em;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: clamp(14px, 1.72vw, 33px);
		letter-spacing: 0.06em;
		color: var(--color-mixup-paper);
		width: clamp(120px, 18vw, 345px);
		flex: 0 0 auto;
		min-width: 0;
	}

	.tv-row__streak,
	.tv-row__move {
		font-size: 0.72em;
		line-height: 1;
		flex: 0 0 auto;
	}

	.tv-row__track {
		flex: 1 1 auto;
		height: clamp(6px, 0.78vw, 15px);
		background: rgba(11, 11, 31, 0.7);
		border-radius: 99px;
		overflow: hidden;
		display: block;
		min-width: 0;
	}

	.tv-row__fill {
		display: block;
		height: 100%;
		border-radius: 99px;
		transition: width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.tv-row__score {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: clamp(22px, 2.65vw, 51px);
		color: var(--color-mixup-yellow);
		text-shadow: 0 0 16px rgba(255, 230, 0, 0.4);
		width: clamp(60px, 8.6vw, 165px);
		text-align: right;
		flex: 0 0 auto;
		font-variant-numeric: tabular-nums;
	}

	.tv-row__crown {
		width: clamp(30px, 4.1vw, 78px);
		display: flex;
		justify-content: center;
		flex: 0 0 auto;
	}

	.tv-row__crown img {
		height: clamp(28px, 3.9vw, 75px);
		object-fit: contain;
		filter: drop-shadow(0 0 14px rgba(255, 215, 94, 0.6));
	}

	@media (prefers-reduced-motion: reduce) {
		.tv-row__fill {
			transition: none;
		}
	}
</style>
