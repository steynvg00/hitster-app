<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let leaving = $state(false);

	async function leaveGame() {
		if (!confirm('Leave the game? Your session will be removed.')) return;
		leaving = true;
		try {
			await fetch('/api/player/leave', { method: 'POST' });
		} finally {
			// Navigate home regardless of fetch result
			window.location.href = '/';
		}
	}
</script>

<svelte:head>
	<title>Lobby — Hitster</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 py-12 text-center">
	<!-- Player card -->
	<div class="mb-8 flex flex-col items-center gap-3">
		{#if data.player.photo_url}
			<img
				src={data.player.photo_url}
				alt={data.player.display_name}
				class="h-20 w-20 rounded-full object-cover ring-2 ring-amber-400/50"
			/>
		{:else}
			<div
				class="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-800 text-3xl font-black text-zinc-500"
			>
				{data.player.display_name.charAt(0).toUpperCase()}
			</div>
		{/if}
		<div>
			<div class="text-lg font-bold text-white">{data.player.display_name}</div>
			<div class="text-xs text-zinc-500">
				{data.mode === 'teams' ? 'Team game' : 'Solo player'}
			</div>
		</div>
	</div>

	<!-- Stub content -->
	<div class="mb-10 rounded-2xl border border-zinc-800 bg-zinc-900 px-8 py-10 text-center">
		<div class="mb-3 text-4xl">🎵</div>
		<h1 class="mb-2 text-xl font-black text-white">Coming soon</h1>
		<p class="max-w-xs text-sm text-zinc-400">
			Game set selection and the full lobby are coming in Session 8c. You're all set for when it's
			ready!
		</p>
	</div>

	<button
		onclick={leaveGame}
		disabled={leaving}
		class="rounded-lg border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-400 transition-colors hover:border-red-700 hover:text-red-400 disabled:opacity-50"
	>
		{leaving ? 'Leaving…' : 'Leave game'}
	</button>
</div>
