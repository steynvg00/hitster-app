<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import { Crown } from 'lucide-svelte';
	import type { PageData } from './$types';

	type TeamRow = (typeof data.teams)[number];

	let { data }: { data: PageData } = $props();

	let teams = $state<TeamRow[]>([...data.teams]);
	let scoresHidden = $state(data.scoresHidden);
	let maxScore = $derived(Math.max(...teams.map((t) => t.score), 20));
	let crownHolderTeamId = $state(data.crownHolderTeamId);

	// Track previous ranks to show position change arrows
	let prevRanks = $state<Map<string, number>>(new Map(teams.map((t, i) => [t.id, i])));
	let rankDeltas = $state<Map<string, number>>(new Map());

	function updateRanks(newTeams: TeamRow[]) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const deltas = new Map<string, number>();
		newTeams.forEach((t, newIdx) => {
			const prev = prevRanks.get(t.id) ?? newIdx;
			if (prev !== newIdx) deltas.set(t.id, prev - newIdx); // positive = moved up
		});
		rankDeltas = deltas;
		prevRanks = new Map(newTeams.map((t, i) => [t.id, i]));
		teams = newTeams;
		// Clear deltas after animation
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
		black: '#1e293b'
	};

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
						const gs = payload.new as { play_state?: string; scores_hidden?: boolean; crown_holder_team_id?: string | null };
						if (gs.play_state === 'recap') goto(`/play/waiting?set_id=${data.activeSetId}`);
						if (typeof gs.scores_hidden === 'boolean') scoresHidden = gs.scores_hidden;
						if ('crown_holder_team_id' in gs) crownHolderTeamId = gs.crown_holder_team_id ?? null;
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

<div class="min-h-screen p-6">
	<div class="mx-auto max-w-lg">
		<!-- Header -->
		<div class="mb-6 flex items-center gap-4">
			<a href="/team" class="text-sm text-zinc-500 transition-colors hover:text-zinc-300">← Team</a>
			<div>
				<p class="text-xs font-bold tracking-[0.2em] text-zinc-500 uppercase">Defqon.1</p>
				<h1 class="text-2xl font-black tracking-tight text-white uppercase">Leaderboard</h1>
			</div>
		</div>

		{#if scoresHidden}
			<div
				class="mb-4 rounded-xl border border-amber-800/50 bg-amber-900/20 px-4 py-2.5 text-center text-sm text-amber-400"
			>
				🔒 Scores hidden by host
			</div>
		{/if}

		<!-- Team cards -->
		<div class="space-y-3">
			{#each teams as team, i (team.id)}
				{@const hex = teamColor[team.color] ?? '#6b7280'}
				{@const delta = rankDeltas.get(team.id) ?? 0}
				<div
					class="overflow-hidden rounded-2xl border bg-zinc-900 transition-all duration-500"
					style="border-color: {hex}40;"
				>
					<!-- Card header: rank + name + badges -->
					<div class="flex items-center gap-3 px-4 pt-3 pb-2">
						<!-- Rank -->
						<div class="flex shrink-0 items-center gap-1.5">
							<span class="text-2xl font-black" style="color: {hex};">{i + 1}</span>
							{#if delta !== 0}
								<span
									class="text-xs font-bold {delta > 0
										? 'text-green-400'
										: 'text-red-400'} animate-bounce"
								>
									{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
								</span>
							{/if}
						</div>

						<!-- Photo avatar -->
						{#if (team as unknown as { photo_url?: string | null }).photo_url}
							<img
								src={(team as unknown as { photo_url?: string | null }).photo_url!}
								alt={team.display_name}
								class="h-8 w-8 rounded-full border-2 object-cover"
								style="border-color: {hex};"
							/>
						{:else}
							<div
								class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
								style="background-color: {hex}33; border: 1.5px solid {hex}66;"
							>
								{team.display_name[0]?.toUpperCase() ?? '?'}
							</div>
						{/if}

						<!-- Name -->
						<div class="flex min-w-0 flex-1 items-center gap-1.5">
							<div class="truncate font-bold text-white">{team.display_name}</div>
							{#if crownHolderTeamId === team.id}
								<Crown size={14} style="color: #ffe600; flex-shrink: 0;" />
							{/if}
						</div>

						<!-- Streak badge -->
						{#if (team as unknown as { current_streak?: number }).current_streak && (team as unknown as { current_streak?: number }).current_streak! >= 2}
							<div
								class="flex shrink-0 items-center gap-1 rounded-full border border-orange-700/40 bg-orange-900/40 px-2 py-0.5 text-xs font-bold text-orange-400"
							>
								🔥{(team as unknown as { current_streak?: number }).current_streak}
							</div>
						{/if}
					</div>

					<!-- Score bar -->
					<div class="px-4 pb-3">
						<div class="relative h-8 overflow-hidden rounded-lg bg-zinc-800">
							<div
								class="flex h-full items-center justify-end rounded-lg pr-3 transition-all duration-700 ease-out"
								style="width: max(3%, {(team.score / maxScore) * 100}%); background-color: {hex};"
							>
								{#if team.score > 0 && !scoresHidden}
									<span class="text-sm font-black text-white drop-shadow">{team.score}</span>
								{/if}
							</div>
							{#if !scoresHidden && team.score === 0}
								<span class="absolute top-1/2 left-3 -translate-y-1/2 text-xs text-zinc-600">0</span
								>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Live indicator -->
		<div class="mt-6 flex items-center justify-center gap-2 text-xs text-zinc-600">
			<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
			Live
		</div>
	</div>
</div>
