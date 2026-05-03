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

	// Podium slots — 2nd left, 1st centre (tallest), 3rd right
	const podiumSlots = $derived(
		totalTeams >= 2
			? [
					{ pos: 2, team: data.rankedTeams[totalTeams - 2], pedestalH: 'h-28', pedestalBg: '#6b7280' },
					{ pos: 1, team: data.rankedTeams[totalTeams - 1], pedestalH: 'h-40', pedestalBg: '#f59e0b' },
					...(totalTeams >= 3
						? [{ pos: 3, team: data.rankedTeams[totalTeams - 3], pedestalH: 'h-16', pedestalBg: '#92400e' }]
						: [])
			  ]
			: []
	);

	// Non-podium teams (4th place and below), revealed only
	const lowerTeams = $derived(
		totalTeams > 3
			? data.rankedTeams.slice(0, totalTeams - 3).filter((t) => isRevealed(t.id))
			: []
	);
</script>

<svelte:head>
	<title>{data.setName} — Podium</title>
</svelte:head>

<div class="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-8">
	<!-- Title -->
	<div class="mb-10 text-center">
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
		<!-- 4th place and below (flat grid, revealed order) -->
		{#if lowerTeams.length > 0}
			<div class="mb-8 flex flex-wrap justify-center gap-3 max-w-4xl w-full">
				{#each lowerTeams as team}
					{@const pos = rankPosition(team.id)}
					{@const tc = teamColors[team.color] ?? { bg: '#27272a', border: '#3f3f46', text: '#fff' }}
					{@const teamPlayers = data.playersByTeam[team.id] ?? []}
					<div class="rounded-xl border-2 overflow-hidden w-36 transition-all duration-500"
						style="border-color: {tc.border}; background-color: {tc.bg};">
						<div class="p-3 text-center" style="color: {tc.text};">
							<div class="text-2xl font-black tabular-nums">{ordinal(pos)}</div>
							<div class="text-sm font-bold uppercase">{team.display_name}</div>
							<div class="text-xl font-black tabular-nums">{team.setScore}</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Olympic podium: 2nd | 1st | 3rd -->
		<div class="flex items-end justify-center gap-4 w-full max-w-4xl">
			{#each podiumSlots as slot}
				{@const revealed = isRevealed(slot.team.id)}
				{@const tc = teamColors[slot.team.color] ?? { bg: '#27272a', border: '#3f3f46', text: '#fff' }}
				{@const teamPlayers = data.playersByTeam[slot.team.id] ?? []}
				{@const isAnimating = animatingTeamId === slot.team.id}

				<div class="flex flex-col items-center {slot.pos === 1 ? 'w-2/5' : 'w-1/4'}">
					<!-- Team card (or placeholder) -->
					{#if revealed}
						<div class="w-full rounded-2xl border-2 overflow-hidden mb-0 transition-all duration-700
							{isAnimating ? 'scale-105 shadow-2xl shadow-amber-400/30' : ''}"
							style="border-color: {tc.border}; background-color: {tc.bg};">
							<div class="p-4 text-center" style="color: {tc.text};">
								<div class="{slot.pos === 1 ? 'text-6xl' : 'text-4xl'} font-black tabular-nums md:text-7xl"
									style="text-shadow: 0 2px 8px rgba(0,0,0,0.4);">
									{ordinal(slot.pos)}
								</div>
								<div class="{slot.pos === 1 ? 'text-2xl' : 'text-lg'} font-black uppercase tracking-wide">
									{slot.team.display_name}
								</div>
								<div class="{slot.pos === 1 ? 'text-4xl' : 'text-2xl'} font-black tabular-nums mt-1">
									{slot.team.setScore}
								</div>
								<div class="text-xs opacity-60 uppercase tracking-wide">points</div>
								{#if teamPlayers.length > 0}
									<div class="mt-3 flex flex-wrap justify-center gap-1">
										{#each teamPlayers as p}
											<div class="text-center">
												{#if p.photo_url}
													<img src={p.photo_url} alt={p.display_name}
														class="h-8 w-8 rounded-full object-cover border-2 mx-auto"
														style="border-color: {tc.text}40" />
												{:else}
													<div class="flex h-8 w-8 items-center justify-center rounded-full mx-auto"
														style="background-color: rgba(0,0,0,0.2); color: {tc.text};">
														<span class="text-sm font-black">{p.display_name.charAt(0)}</span>
													</div>
												{/if}
												<div class="mt-0.5 text-xs opacity-80">{p.display_name}</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					{:else}
						<!-- Not yet revealed placeholder -->
						<div class="w-full rounded-2xl border-2 border-zinc-700 bg-zinc-900 mb-0">
							<div class="p-6 text-center">
								<div class="text-5xl font-black text-zinc-700">?</div>
							</div>
						</div>
					{/if}

					<!-- Pedestal block -->
					<div class="{slot.pedestalH} w-full rounded-t-xl flex items-center justify-center mt-2"
						style="background-color: {slot.pedestalBg};">
						<span class="{slot.pos === 1 ? 'text-5xl' : 'text-3xl'} font-black text-white"
							style="text-shadow: 0 2px 4px rgba(0,0,0,0.4);">
							{slot.pos}
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Live indicator -->
	<div class="mt-12 flex items-center gap-2 text-xs text-zinc-600">
		<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
		Live reveal
	</div>
</div>
