<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import { Crown } from 'lucide-svelte';
	import type { PageData } from './$types';

	type TeamRow = (typeof data.teams)[number];

	let { data }: { data: PageData } = $props();
	let teams = $state<TeamRow[]>([...data.teams]);
	let maxScore = $derived(Math.max(...teams.map((t) => t.score), 20));
	/**
	 * Kroon-WEERGAVE volgt de score: zichtbaar bij elk team waarvan de score
	 * gelijk is aan de hoogste score, en alleen als die boven 0 ligt. Bij 0-0
	 * dus geen kroon; bij een gedeelde topscore dragen alle koplopers er een.
	 * LET OP: maxScore hierboven heeft een ondergrens van 20 voor de balkbreedtes
	 * en is daarom NIET bruikbaar als topscore.
	 */
	let topScore = $derived(Math.max(...teams.map((t) => t.score), 0));

	// Position change tracking
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

	const teamColor: Record<string, string> = {
		blue: '#3b82f6',
		yellow: '#eab308',
		green: '#22c55e',
		red: '#ef4444',
		indigo: '#6366f1',
		black: '#64748b'
	};

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

<div class="min-h-screen p-6 md:p-10">
	<!-- Header -->
	<div class="mb-10 text-center">
		<h1 class="text-4xl font-black tracking-tight uppercase md:text-6xl">Leaderboard</h1>
	</div>

	<!-- Team cards -->
	<div class="mx-auto max-w-3xl space-y-4">
		{#each teams as team, i (team.id)}
			{@const hex = teamColor[team.color] ?? '#6b7280'}
			{@const delta = rankDeltas.get(team.id) ?? 0}
			<div
				class="overflow-hidden rounded-2xl border bg-zinc-900 transition-all duration-500"
				style="border-color: {hex}40;"
			>
				<!-- Card header -->
				<div class="flex items-center gap-4 px-5 pt-4 pb-2">
					<!-- Rank -->
					<div class="flex shrink-0 items-center gap-2">
						<span class="text-3xl font-black md:text-4xl" style="color: {hex};">{i + 1}</span>
						{#if delta !== 0}
							<span
								class="text-sm font-bold md:text-base {delta > 0
									? 'text-green-400'
									: 'text-red-400'} animate-bounce"
							>
								{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
							</span>
						{/if}
					</div>

					<!-- Photo -->
					{#if (team as unknown as { photo_url?: string | null }).photo_url}
						<img
							src={(team as unknown as { photo_url?: string | null }).photo_url!}
							alt={team.display_name}
							class="h-10 w-10 rounded-full border-2 object-cover md:h-12 md:w-12"
							style="border-color: {hex};"
						/>
					{:else}
						<div
							class="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white md:h-12 md:w-12 md:text-base"
							style="background-color: {hex}33; border: 1.5px solid {hex}66;"
						>
							{team.display_name[0]?.toUpperCase() ?? '?'}
						</div>
					{/if}

					<!-- Name -->
					<div class="flex min-w-0 flex-1 items-center gap-2">
						<div class="truncate text-lg font-bold text-white md:text-xl">{team.display_name}</div>
						{#if topScore > 0 && team.score === topScore}
							<Crown size={18} style="color: #ffe600; flex-shrink: 0;" />
						{/if}
					</div>

					<!-- Streak badge -->
					{#if (team as unknown as { current_streak?: number }).current_streak && (team as unknown as { current_streak?: number }).current_streak! >= 2}
						<div
							class="flex shrink-0 items-center gap-1.5 rounded-full border border-orange-700/40 bg-orange-900/40 px-3 py-1 text-sm font-bold text-orange-400"
						>
							🔥{(team as unknown as { current_streak?: number }).current_streak}
						</div>
					{/if}

					<!-- Score label -->
					<div class="shrink-0 text-right">
						<div class="text-2xl font-black md:text-3xl" style="color: {hex};">{team.score}</div>
						<div class="text-xs text-zinc-600">pts</div>
					</div>
				</div>

				<!-- Score bar -->
				<div class="px-5 pb-4">
					<div class="relative h-3 overflow-hidden rounded-full bg-zinc-800">
						<div
							class="h-full rounded-full transition-all duration-700 ease-out"
							style="width: max(1%, {(team.score / maxScore) * 100}%); background-color: {hex};"
						></div>
					</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- Live indicator -->
	<div class="mt-10 flex items-center justify-center gap-2 text-xs text-zinc-600">
		<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
		Live
	</div>
</div>
