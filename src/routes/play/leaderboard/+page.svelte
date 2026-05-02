<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData } from './$types';
	import type { TeamRow } from '$lib/types/database';

	let { data }: { data: PageData } = $props();

	let teams: TeamRow[] = $state(untrack(() => data.teams));
	let maxScore = $derived(Math.max(...teams.map((t) => t.score), 20));

	const teamColor: Record<string, string> = {
		blue: '#3b82f6',
		yellow: '#eab308',
		green: '#22c55e',
		red: '#ef4444',
		indigo: '#6366f1',
		black: '#1e293b'
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
		const teamsChannel = supabaseBrowser
			.channel('play-leaderboard-teams')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, async () => {
				const { data: updated } = await supabaseBrowser
					.from('teams')
					.select('*')
					.order('score', { ascending: false });
				if (updated) teams = updated;
			})
			.subscribe();

		// If player is in a set, subscribe to set status changes.
		// When the set ends (completed), redirect away — leaderboard hidden during suspense.
		let setChannel: ReturnType<typeof supabaseBrowser.channel> | null = null;
		if (data.activeSetId) {
			setChannel = supabaseBrowser
				.channel(`play-leaderboard-set-${data.activeSetId}`)
				.on('postgres_changes', {
					event: 'UPDATE',
					schema: 'public',
					table: 'game_sets',
					filter: `id=eq.${data.activeSetId}`
				}, (payload) => {
					if ((payload.new as { status: string }).status === 'completed') {
						window.location.href = '/team';
					}
				})
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
		<div class="mb-8 flex items-center gap-4">
			<a href="/team" class="text-zinc-500 hover:text-zinc-300 transition-colors text-sm">← Team</a>
			<div>
				<p class="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Defqon.1</p>
				<h1 class="text-2xl font-black uppercase tracking-tight text-white">Leaderboard</h1>
			</div>
		</div>

		<!-- Team bars -->
		<div class="space-y-3">
			{#each teams as team, i (team.id)}
				<div class="flex items-center gap-3">
					<!-- Rank -->
					<div class="w-5 shrink-0 text-right text-sm font-bold text-zinc-600">{i + 1}</div>

					<!-- Team name -->
					<div class="w-28 shrink-0 truncate text-sm font-bold {teamTextColor[team.color] ?? 'text-zinc-400'}">
						{team.display_name}
					</div>

					<!-- Animated score bar -->
					<div class="relative h-10 flex-1 overflow-hidden rounded-r-lg bg-zinc-800">
						<div
							class="flex h-full items-center justify-end rounded-r-lg pr-3 transition-all duration-700 ease-out"
							style="width: max(3%, {(team.score / maxScore) * 100}%); background-color: {teamColor[team.color] ?? '#6b7280'};"
						>
							{#if team.score > 0}
								<span class="text-sm font-black text-white drop-shadow">{team.score}</span>
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
		<div class="mt-8 flex items-center justify-center gap-2 text-xs text-zinc-600">
			<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
			Live
		</div>
	</div>
</div>
