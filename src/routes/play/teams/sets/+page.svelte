<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let joining = $state<string | null>(null);
</script>

<svelte:head>
	<title>Pick a Game — Hitster</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-zinc-950 px-5 py-8">
	<!-- Player identity strip -->
	<div class="mb-8 flex items-center gap-3">
		{#if data.player.photo_url}
			<img
				src={data.player.photo_url}
				alt={data.player.display_name}
				class="h-10 w-10 rounded-full object-cover ring-2 ring-amber-400/40"
			/>
		{:else}
			<div
				class="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 font-black text-zinc-400"
			>
				{data.player.display_name.charAt(0).toUpperCase()}
			</div>
		{/if}
		<div>
			<div class="text-sm font-semibold text-white">{data.player.display_name}</div>
			<div class="text-xs text-zinc-500">Pick a game to join</div>
		</div>
	</div>

	<div class="mx-auto w-full max-w-sm flex-1">
		<h1 class="mb-6 text-2xl font-black text-white">Active Games</h1>

		{#if form?.error}
			<div
				class="mb-5 rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-300"
			>
				{form.error}
			</div>
		{/if}

		{#if data.sets.length === 0}
			<div class="rounded-2xl border border-zinc-800 bg-zinc-900 px-8 py-12 text-center">
				<div class="mb-3 text-4xl">⏳</div>
				<h2 class="mb-2 text-lg font-bold text-white">No active games</h2>
				<p class="text-sm text-zinc-400">Ask the host to activate a game set.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each data.sets as set}
					<form method="POST" action="?/join" use:enhance={() => {
						joining = set.id;
						return async ({ update }) => {
							joining = null;
							await update();
						};
					}}>
						<input type="hidden" name="set_id" value={set.id} />
						<button
							type="submit"
							disabled={joining !== null}
							class="w-full rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-left transition-all hover:border-amber-400/50 hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-60"
						>
							<div class="mb-1 flex items-start justify-between gap-2">
								<span class="font-bold text-white">{set.name}</span>
								<span class="shrink-0 rounded-full bg-green-900/60 px-2 py-0.5 text-xs font-semibold text-green-400">
									Active
								</span>
							</div>
							{#if set.description}
								<p class="mb-2 text-sm text-zinc-400">{set.description}</p>
							{/if}
							<div class="flex gap-4 text-xs text-zinc-500">
								<span>{set.team_count} teams</span>
								<span>{set.player_count} joined</span>
							</div>
							{#if joining === set.id}
								<div class="mt-3 text-center text-sm font-semibold text-amber-400">
									Randomizing…
								</div>
							{/if}
						</button>
					</form>
				{/each}
			</div>
		{/if}
	</div>
</div>
