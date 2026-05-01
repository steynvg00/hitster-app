<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	const STAGE_COLORS = ['#3b82f6', '#eab308', '#22c55e', '#ef4444', '#6366f1', '#64748b'];
</script>

<svelte:head>
	<title>Hitster — Defqon Edition</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 py-16">
	<!-- Game in progress banner -->
	{#if data.hasActiveGame}
		<a
			href="/leaderboard"
			class="mb-10 flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-5 py-2 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-400/20"
		>
			<span class="relative flex h-2 w-2">
				<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
				<span class="relative inline-flex h-2 w-2 rounded-full bg-amber-400"></span>
			</span>
			Game in progress — view leaderboard →
		</a>
	{/if}

	<!-- Logo -->
	<div class="mb-12 text-center">
		<div class="mb-5 flex justify-center gap-2">
			{#each STAGE_COLORS as color}
				<div class="h-3 w-3 rounded-full" style="background: {color}"></div>
			{/each}
		</div>
		<h1
			class="text-[5rem] font-black uppercase leading-none tracking-tighter text-white sm:text-[7rem]"
		>
			HITSTER
		</h1>
		<p class="mt-2 text-xs font-bold uppercase tracking-[0.5em] text-zinc-500">
			Defqon Edition
		</p>
	</div>

	<!-- Mode buttons -->
	<div class="flex w-full max-w-xs flex-col gap-4">
		<a href="/play/teams" class="mode-btn mode-btn--teams">
			<span class="text-3xl leading-none">🎵</span>
			<div>
				<div class="text-xl font-black">Teams</div>
				<div class="text-sm font-medium opacity-60">Join your group</div>
			</div>
		</a>

		<a href="/play/solo" class="mode-btn mode-btn--solo">
			<span class="text-3xl leading-none">🎧</span>
			<div>
				<div class="text-xl font-black">Solo Player</div>
				<div class="text-sm font-medium opacity-60">Play on your own</div>
			</div>
		</a>

		<a href="/admin/login" class="mt-2 block text-center text-sm text-zinc-600 transition-colors hover:text-zinc-400">
			Host login →
		</a>
	</div>
</div>

<style>
	.mode-btn {
		display: flex;
		align-items: center;
		gap: 1.125rem;
		padding: 1.25rem 1.5rem;
		border-radius: 1rem;
		font-weight: 700;
		text-decoration: none;
		transition:
			transform 0.12s ease,
			filter 0.12s ease;
	}
	.mode-btn:active {
		transform: scale(0.97);
	}
	.mode-btn:hover {
		filter: brightness(1.08);
	}
	.mode-btn--teams {
		background: #fbbf24;
		color: #09090b;
	}
	.mode-btn--solo {
		background: #4f46e5;
		color: #ffffff;
	}
</style>
