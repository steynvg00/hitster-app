<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData } from './$types';
	import type { TeamRow } from '$lib/types/database';

	let { data }: { data: PageData } = $props();
	// untrack: initial value only — realtime subscription keeps it live after that
	let teams: TeamRow[] = $state(untrack(() => data.teams));

	// Bar width is relative to the highest score (minimum 20 so bars aren't full-width at game start)
	let maxScore = $derived(Math.max(...teams.map((t) => t.score), 20));

	// CSS color for each team — using explicit values so Tailwind purging isn't an issue
	const teamColor: Record<string, string> = {
		blue: '#3b82f6',
		yellow: '#eab308',
		green: '#22c55e',
		red: '#ef4444',
		indigo: '#6366f1',
		black: '#64748b'
	};

	const teamTextColor: Record<string, string> = {
		blue: 'text-blue-400',
		yellow: 'text-yellow-400',
		green: 'text-green-400',
		red: 'text-red-400',
		indigo: 'text-indigo-400',
		black: 'text-slate-400'
	};

	onMount(() => {
		// Subscribe to score changes — re-fetch full sorted list on any update
		const channel = supabaseBrowser
			.channel('leaderboard')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, async () => {
				const { data: updated } = await supabaseBrowser
					.from('teams')
					.select('*')
					.order('score', { ascending: false });
				if (updated) teams = updated;
			})
			.subscribe();

		return () => supabaseBrowser.removeChannel(channel);
	});
</script>

<div class="min-h-screen p-6 md:p-10">
	<!-- Header -->
	<div class="mb-10 text-center">
		<h1 class="text-4xl font-black uppercase tracking-tight md:text-6xl">Leaderboard</h1>
	</div>

	<!-- Team bars -->
	<div class="mx-auto max-w-3xl space-y-4">
		{#each teams as team, i (team.id)}
			<div class="flex items-center gap-4">
				<!-- Rank -->
				<div class="w-6 shrink-0 text-right text-sm font-bold text-zinc-600">{i + 1}</div>

				<!-- Team name -->
				<div
					class="w-36 shrink-0 truncate text-sm font-bold md:w-48 md:text-base {teamTextColor[
						team.color
					] ?? 'text-zinc-400'}"
				>
					{team.display_name}
				</div>

				<!-- Animated score bar -->
				<div class="relative h-10 flex-1 overflow-hidden rounded-r-lg bg-zinc-800 md:h-12">
					<div
						class="flex h-full items-center justify-end rounded-r-lg pr-3 transition-all duration-700 ease-out"
						style="width: max(2%, {(team.score / maxScore) * 100}%); background-color: {teamColor[
							team.color
						] ?? '#6b7280'};"
					>
						{#if team.score > 0}
							<span class="text-sm font-black text-white drop-shadow md:text-base">
								{team.score}
							</span>
						{/if}
					</div>
					{#if team.score === 0}
						<span class="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-600">0</span>
					{/if}
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
