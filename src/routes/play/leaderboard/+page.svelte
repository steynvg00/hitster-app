<script lang="ts">
	/**
	 * 9 · LEADERBOARD — LIVE STAND (redesign fase 5).
	 *
	 * Bron: design/M!XUP Player Flow v2.dc.html, scherm "9 · LEADERBOARD —
	 * STREAK · RANGWISSEL · SUSPENSE".
	 *
	 * PUUR PRESENTATIE. Beide realtime-kanalen (teams + game_sets), de refetch
	 * en de redirect naar het wachtscherm zijn ongewijzigd overgenomen; alleen
	 * de vormgeving is nieuw.
	 *
	 * De suspense-state uit het design is hier gekoppeld aan het BESTAANDE
	 * host-signaal `game_sets.scores_hidden` — dat is precies wat de designknop
	 * "SUSPENSE AAN (HOST-DEMO)" nabootst. Er komt dus geen tweede schakelaar bij.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import PlayerScreen from '$lib/components/game/PlayerScreen.svelte';
	import { teamHex } from '$lib/team-theme';
	import { topScoreOf, wearsCrown, livePlaceLabel } from '$lib/standings';
	import type { PageData } from './$types';

	type TeamRow = (typeof data.teams)[number];

	let { data }: { data: PageData } = $props();

	let teams = $state<TeamRow[]>([...data.teams]);
	let scoresHidden = $state(data.scoresHidden);

	/** Noemer voor de balkbreedtes — ondergrens 20 zodat een lege stand niet deelt door nul. */
	let barMax = $derived(Math.max(...teams.map((t) => t.score), 20));
	/** De echte topscore; voedt de kroon-conditie (zie $lib/standings). */
	let topScore = $derived(topScoreOf(teams));

	// Rangwissel-indicatoren: onthoud de vorige volgorde en toon 3 seconden lang
	// een pijl bij elk team dat van plek wisselde.
	let prevRanks = $state<Map<string, number>>(new Map(teams.map((t, i) => [t.id, i])));
	let rankDeltas = $state<Map<string, number>>(new Map());

	function updateRanks(newTeams: TeamRow[]) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const deltas = new Map<string, number>();
		newTeams.forEach((t, newIdx) => {
			const prev = prevRanks.get(t.id) ?? newIdx;
			if (prev !== newIdx) deltas.set(t.id, prev - newIdx); // positief = omhoog
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
		const teamsChannel = supabaseBrowser
			.channel('play-leaderboard-teams')
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
				.channel(`play-leaderboard-set-${data.activeSetId}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'game_sets',
						filter: `id=eq.${data.activeSetId}`
					},
					(payload) => {
						const gs = payload.new as {
							play_state?: string;
							scores_hidden?: boolean;
							crown_holder_team_id?: string | null;
						};
						if (gs.play_state === 'recap') goto(`/play/waiting?set_id=${data.activeSetId}`);
						if (typeof gs.scores_hidden === 'boolean') scoresHidden = gs.scores_hidden;
					}
				)
				.subscribe();
		}

		return () => {
			supabaseBrowser.removeChannel(teamsChannel);
			if (setChannel) supabaseBrowser.removeChannel(setChannel);
		};
	});
</script>

<svelte:head>
	<title>Live stand — M!XUP</title>
</svelte:head>

<PlayerScreen rain corners={0.35} fitViewport class="px-5">
	<a href="/team" class="back-link">← TEAM</a>

	<h1 class="lb-title">Live stand</h1>
	<p class="lb-sub">
		{scoresHidden
			? 'Suspense-modus — de host onthult de stand zo…'
			: 'Realtime · update na elke ronde'}
	</p>

	<div class="lb-list">
		{#each teams as team, i (team.id)}
			{@const hex = teamHex(team.color)}
			{@const delta = rankDeltas.get(team.id) ?? 0}
			{@const streak = streakOf(team)}
			<div class="lb-row squircle">
				<div class="lb-row__head">
					<span class="lb-rank">{livePlaceLabel(team.score, i + 1)}</span>
					<span class="lb-dot" style="--dot: {hex};"></span>
					<span class="lb-name">{team.display_name}</span>

					{#if streak >= 2}
						<span class="lb-streak" title="{streak} op rij">🔥</span>
					{/if}

					{#if delta !== 0}
						<span class="lb-move" style="color: {delta > 0 ? '#2BD97A' : '#FF2DAA'};">
							{delta > 0 ? '▲' : '▼'}
						</span>
					{/if}

					{#if !scoresHidden && wearsCrown(team.score, topScore)}
						<span class="lb-crown" aria-label="Koploper">♛</span>
					{/if}

					<span class="lb-score">{scoresHidden ? '???' : nl.format(team.score)}</span>
				</div>

				<div class="lb-bar">
					{#if scoresHidden}
						<!-- Suspense: geen echte verhoudingen, alleen een oplopend silhouet. -->
						<div class="lb-bar__fill lb-bar__fill--hidden" style="width: {14 + i * 6}%;"></div>
					{:else}
						<div
							class="lb-bar__fill"
							style="width: {Math.max(2, (team.score / barMax) * 100)}%;
							       background: linear-gradient(90deg, {hex}, rgba(229,242,255,0.65));"
						></div>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<div class="lb-live">
		<span class="lb-live__dot"></span>
		<span>LIVE</span>
	</div>
</PlayerScreen>

<style>
	.back-link {
		align-self: flex-start;
		margin-bottom: 10px;
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.18em;
		color: var(--color-mixup-muted);
		text-decoration: none;
	}

	.lb-title {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 40px;
		line-height: 0.95;
		text-transform: uppercase;
		color: var(--color-mixup-paper);
		text-shadow: 0 0 26px rgba(124, 77, 255, 0.85);
	}

	.lb-sub {
		margin-top: 4px;
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 13px;
		color: var(--color-mixup-muted);
	}

	.lb-list {
		margin-top: 16px;
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.lb-row {
		background: linear-gradient(135deg, rgba(229, 242, 255, 0.1), rgba(229, 242, 255, 0.03));
		border: 1px solid rgba(229, 242, 255, 0.18);
		border-radius: var(--radius-mixup-card);
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: 0 0 auto;
	}

	.lb-row__head {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.lb-rank {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 18px;
		color: var(--color-mixup-muted);
		width: 20px;
		flex: 0 0 auto;
	}

	.lb-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--dot);
		border: 1px solid rgba(229, 242, 255, 0.5);
		box-shadow: 0 0 8px var(--dot);
		flex: 0 0 auto;
	}

	.lb-name {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 13px;
		letter-spacing: 0.08em;
		color: var(--color-mixup-paper);
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lb-streak {
		font-size: 13px;
		line-height: 1;
		flex: 0 0 auto;
	}

	.lb-move {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 13px;
		line-height: 1;
		flex: 0 0 auto;
	}

	.lb-crown {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 16px;
		line-height: 1;
		color: #ffd75e;
		text-shadow: 0 0 10px rgba(255, 215, 94, 0.7);
		flex: 0 0 auto;
	}

	.lb-score {
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 22px;
		color: var(--color-mixup-paper);
		flex: 0 0 auto;
		font-variant-numeric: tabular-nums;
	}

	.lb-bar {
		height: 7px;
		background: rgba(11, 11, 31, 0.7);
		border-radius: 99px;
		overflow: hidden;
	}

	.lb-bar__fill {
		height: 100%;
		border-radius: 99px;
		transition: width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.lb-bar__fill--hidden {
		background: rgba(229, 242, 255, 0.15);
	}

	.lb-live {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin-top: 14px;
		font-family: var(--font-data);
		font-size: 10px;
		letter-spacing: 0.18em;
		color: var(--color-mixup-dim);
		flex: 0 0 auto;
	}

	.lb-live__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--color-mixup-magenta);
		animation: lb-pulse 1.2s infinite;
	}

	@keyframes lb-pulse {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lb-live__dot {
			animation: none;
			opacity: 1;
		}
		.lb-bar__fill {
			transition: none;
		}
	}
</style>
