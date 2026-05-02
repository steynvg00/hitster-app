<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const gs = $derived(data.gameSet);

	let revealIndex = $state(untrack(() => gs.recap_reveal_index ?? 0));
	let ranking = $state<string[]>(untrack(() => (gs.recap_ranking as string[]) ?? []));

	const totalTeams = $derived(data.rankedTeams.length);

	function isRevealed(teamId: string): boolean {
		if (ranking.length === 0) return false;
		const pos = ranking.indexOf(teamId);
		return pos !== -1 && pos < revealIndex;
	}

	function rankPosition(teamId: string): number {
		const pos = ranking.indexOf(teamId);
		if (pos === -1) return 0;
		return totalTeams - pos;
	}

	// Track most recently revealed for entrance animation
	let animatingTeamId = $state<string | null>(null);

	const teamColors: Record<string, { bg: string; border: string; text: string }> = {
		blue: { bg: '#1d4ed8', border: '#3b82f6', text: '#fff' },
		yellow: { bg: '#ca8a04', border: '#eab308', text: '#000' },
		green: { bg: '#15803d', border: '#22c55e', text: '#fff' },
		red: { bg: '#b91c1c', border: '#ef4444', text: '#fff' },
		indigo: { bg: '#4338ca', border: '#6366f1', text: '#fff' },
		black: { bg: '#18181b', border: '#3f3f46', text: '#fff' }
	};

	const ordinal = (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	};

	let animTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`podium-${gs.id}`)
			.on('postgres_changes', {
				event: 'UPDATE',
				schema: 'public',
				table: 'game_sets',
				filter: `id=eq.${gs.id}`
			}, (payload) => {
				const updated = payload.new as {
					recap_reveal_index: number;
					recap_ranking: string[];
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
			})
			.subscribe();

		return () => {
			supabaseBrowser.removeChannel(channel);
			if (animTimer) clearTimeout(animTimer);
		};
	});
</script>

<svelte:head>
	<title>{data.setName} — Podium</title>
</svelte:head>

<div class="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8">
	<!-- Title -->
	<div class="mb-12 text-center">
		<p class="mb-1 text-sm font-bold uppercase tracking-[0.3em] text-zinc-500">Defqon.1 Weekend</p>
		<h1 class="text-5xl font-black uppercase tracking-tight text-white md:text-7xl">Podium</h1>
		<p class="mt-2 text-zinc-500">{data.setName}</p>
	</div>

	{#if revealIndex === 0}
		<div class="text-center">
			<div class="text-6xl mb-6 animate-pulse">🎵</div>
			<p class="text-2xl font-bold text-zinc-400">Stand by for the reveal…</p>
		</div>
	{:else}
		<!-- Revealed teams grid (displayed from first revealed = last place, descending as more are revealed) -->
		<div class="grid w-full max-w-4xl gap-4" style="grid-template-columns: repeat({Math.min(revealIndex, totalTeams)}, minmax(0, 1fr))">
			{#each data.rankedTeams as team}
				{#if isRevealed(team.id)}
					{@const pos = rankPosition(team.id)}
					{@const tc = teamColors[team.color] ?? { bg: '#27272a', border: '#3f3f46', text: '#fff' }}
					{@const teamPlayers = data.playersByTeam[team.id] ?? []}
					{@const isAnimating = animatingTeamId === team.id}

					<div class="rounded-2xl border-2 overflow-hidden transition-all duration-500
						{isAnimating ? 'scale-105 shadow-2xl' : 'scale-100'}"
						style="border-color: {tc.border}; background-color: {tc.bg};">
						<div class="p-5 text-center" style="color: {tc.text};">
							<!-- Position -->
							<div class="mb-1 text-5xl font-black tabular-nums md:text-7xl"
								style="text-shadow: 0 2px 8px rgba(0,0,0,0.4);">
								{ordinal(pos)}
							</div>
							<!-- Team name -->
							<div class="text-xl font-black uppercase tracking-wide md:text-3xl">{team.display_name}</div>
							<!-- Score -->
							<div class="mt-2 text-4xl font-black tabular-nums md:text-5xl">{team.setScore}</div>
							<div class="text-sm opacity-60 uppercase tracking-wide">points</div>

							<!-- Player photos -->
							{#if teamPlayers.length > 0}
								<div class="mt-4 flex flex-wrap justify-center gap-2">
									{#each teamPlayers as p}
										<div class="text-center">
											{#if p.photo_url}
												<img src={p.photo_url} alt={p.display_name}
													class="h-10 w-10 rounded-full object-cover border-2 mx-auto"
													style="border-color: {tc.text}40" />
											{:else}
												<div class="flex h-10 w-10 items-center justify-center rounded-full mx-auto"
													style="background-color: rgba(0,0,0,0.2); color: {tc.text};">
													<span class="text-sm font-black">{p.display_name.charAt(0)}</span>
												</div>
											{/if}
											<div class="mt-1 text-xs opacity-80">{p.display_name}</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Live indicator -->
	<div class="mt-12 flex items-center gap-2 text-xs text-zinc-600">
		<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
		Live reveal
	</div>
</div>
