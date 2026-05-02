<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const gs = $derived(data.gameSet);

	// ── Reactive player map (updated via realtime) ────────────────────────────
	type PlayerRow = { id: string; display_name: string; photo_url: string | null; team_id: string | null };
	let playersByTeam = $state<Record<string, PlayerRow[]>>(
		Object.fromEntries(
			Object.entries(data.playersByTeam).map(([k, v]) => [k, [...(v ?? [])]])
		) as Record<string, PlayerRow[]>
	);

	function applyPlayerUpdate(p: PlayerRow) {
		// Remove from all teams first
		for (const tid of Object.keys(playersByTeam)) {
			playersByTeam[tid] = playersByTeam[tid].filter((x) => x.id !== p.id);
		}
		// Add to new team if applicable
		if (p.team_id && p.team_id in playersByTeam) {
			playersByTeam[p.team_id] = [...playersByTeam[p.team_id], p];
		}
	}

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`lobby-${gs.id}`)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'players', filter: `set_id=eq.${gs.id}` },
				(payload) => {
					if (payload.eventType === 'DELETE') return;
					const p = payload.new as PlayerRow;
					applyPlayerUpdate(p);
				}
			)
			.subscribe();
		return () => supabaseBrowser.removeChannel(channel);
	});

	// ── Move player UI ────────────────────────────────────────────────────────
	let movingPlayer = $state<{ id: string; name: string } | null>(null);

	const TEAM_COLOR_BG: Record<string, string> = {
		blue: '#1e3a8a',
		yellow: '#713f12',
		green: '#14532d',
		red: '#7f1d1d',
		indigo: '#312e81',
		black: '#18181b'
	};
	const TEAM_COLOR_BORDER: Record<string, string> = {
		blue: '#1d4ed8',
		yellow: '#ca8a04',
		green: '#15803d',
		red: '#b91c1c',
		indigo: '#4338ca',
		black: '#3f3f46'
	};
</script>

<svelte:head>
	<title>Lobby — {gs.name} — Admin</title>
</svelte:head>

<div class="flex h-full flex-col">
	<!-- Top bar -->
	<div class="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-6 py-4">
		<div>
			<a href="/admin/sets/{gs.id}" class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← {gs.name}</a>
			<h1 class="mt-0.5 text-lg font-black text-white">Live Lobby</h1>
		</div>
		<div class="flex items-center gap-3">
			<span class="rounded-full px-2 py-0.5 text-xs font-semibold
				{gs.status === 'active' ? 'bg-green-900/60 text-green-400' : 'bg-zinc-700 text-zinc-300'}">
				{gs.status}
			</span>

			{#if gs.status === 'draft'}
				<form method="POST" action="?/activate" use:enhance>
					<button class="rounded-lg bg-green-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-600 transition-colors">
						Start Set
					</button>
				</form>
			{/if}

			<form method="POST" action="?/reset" use:enhance
				onsubmit={(e) => { if (!confirm('Clear all player assignments for this set?')) e.preventDefault(); }}>
				<button class="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:border-zinc-500 hover:text-white transition-colors">
					Reset All
				</button>
			</form>
		</div>
	</div>

	{#if form?.error}
		<div class="mx-6 mt-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-2 text-sm text-red-400">
			{form.error}
		</div>
	{/if}

	<!-- Team columns grid -->
	<div class="flex-1 overflow-auto p-6">
		<div class="grid gap-4" style="grid-template-columns: repeat({data.teams.length}, minmax(0, 1fr))">
			{#each data.teams as team}
				{@const players = playersByTeam[team.id] ?? []}
				<div class="rounded-xl border bg-zinc-900 overflow-hidden"
					style="border-color: {TEAM_COLOR_BORDER[team.color] ?? '#3f3f46'}">
					<!-- Team header -->
					<div class="px-4 py-3 text-sm font-bold text-white uppercase tracking-wide"
						style="background-color: {TEAM_COLOR_BG[team.color] ?? '#27272a'}">
						{team.display_name}
						<span class="ml-1.5 text-xs font-normal opacity-70">({players.length})</span>
					</div>

					<!-- Player list -->
					<div class="divide-y divide-zinc-800 min-h-16">
						{#each players as p}
							<div class="flex items-center gap-2 px-3 py-2">
								{#if p.photo_url}
									<img src={p.photo_url} alt={p.display_name}
										class="h-8 w-8 rounded-full object-cover shrink-0" />
								{:else}
									<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs font-black text-zinc-400">
										{p.display_name.charAt(0).toUpperCase()}
									</div>
								{/if}
								<span class="flex-1 truncate text-sm text-zinc-200">{p.display_name}</span>
								<button
									type="button"
									onclick={() => movingPlayer = { id: p.id, name: p.display_name }}
									class="shrink-0 rounded p-0.5 text-xs text-zinc-600 hover:text-zinc-300 transition-colors"
									title="Move player"
								>
									⇄
								</button>
							</div>
						{/each}
						{#if players.length === 0}
							<div class="px-3 py-4 text-center text-xs text-zinc-700">Empty</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

<!-- Move player modal -->
{#if movingPlayer}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
		<div class="w-80 rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
			<h2 class="mb-1 font-bold text-white">Move {movingPlayer.name}</h2>
			<p class="mb-4 text-sm text-zinc-400">Choose a new team:</p>
			<div class="space-y-2">
				{#each data.teams as t}
					<form method="POST" action="?/movePlayer" use:enhance={({ cancel }) => {
						movingPlayer = null;
						return async ({ update }) => { await update(); };
					}}>
						<input type="hidden" name="player_id" value={movingPlayer?.id} />
						<input type="hidden" name="team_id" value={t.id} />
						<button
							type="submit"
							class="w-full rounded-lg border px-3 py-2 text-left text-sm font-medium text-white transition-colors hover:opacity-80"
							style="border-color: {TEAM_COLOR_BORDER[t.color] ?? '#3f3f46'}; background-color: {TEAM_COLOR_BG[t.color] ?? '#27272a'}"
						>
							{t.display_name}
						</button>
					</form>
				{/each}
			</div>
			<button
				onclick={() => movingPlayer = null}
				class="mt-4 w-full rounded-lg border border-zinc-700 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
			>
				Cancel
			</button>
		</div>
	</div>
{/if}
