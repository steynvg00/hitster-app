<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { setPresets } from '$lib/presets/setPresets';
	import * as LucideIcons from 'lucide-svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let creatingSlug = $state<string | null>(null);
	let togglingId = $state<string | null>(null);

	const STATUS_BADGE: Record<string, string> = {
		inactive: 'bg-zinc-700 text-zinc-300',
		active: 'bg-green-900/60 text-green-400'
	};

	function getIcon(name: string) {
		return (LucideIcons as Record<string, unknown>)[name] as typeof LucideIcons.Sparkles;
	}
</script>

<svelte:head>
	<title>Game Sets — Admin</title>
</svelte:head>

<div class="p-8">
	<div class="mb-6">
		<h1 class="text-2xl font-black text-white">Game Sets</h1>
		<p class="mt-0.5 text-sm text-zinc-400">Manage rounds and team randomization.</p>
	</div>

	<!-- Preset tile grid -->
	<section class="mb-10">
		<h2 class="mb-4 text-sm font-semibold tracking-widest text-zinc-400 uppercase">
			Start a new game
		</h2>

		{#if form?.error}
			<p class="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-2 text-sm text-red-400">
				{form.error}
			</p>
		{/if}

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each setPresets as preset}
				{#if preset.status === 'ready'}
					<form
						method="POST"
						action="?/createFromPreset"
						use:enhance={() => {
							creatingSlug = preset.slug;
							return async ({ update }) => {
								creatingSlug = null;
								await update();
							};
						}}
					>
						<input type="hidden" name="slug" value={preset.slug} />
						<button
							type="submit"
							disabled={creatingSlug !== null}
							class="group relative flex w-full flex-col items-start gap-3 rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-left transition-all hover:border-amber-400/60 hover:bg-zinc-800 disabled:opacity-60"
						>
							<div
								class="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-amber-400 transition-colors group-hover:bg-amber-400/10"
							>
								{#if creatingSlug === preset.slug}
									<span class="text-xs text-zinc-400">…</span>
								{:else}
									<svelte:component this={getIcon(preset.icon)} size={22} />
								{/if}
							</div>
							<div>
								<p class="text-sm font-bold text-white">{preset.name}</p>
								<p class="mt-0.5 text-xs text-zinc-400">{preset.description}</p>
							</div>
						</button>
					</form>
				{:else}
					<div
						class="relative flex cursor-not-allowed flex-col items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-5 opacity-50"
						title={preset.comingSoonNote}
					>
						<span
							class="absolute top-3 right-3 rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-zinc-400 uppercase"
						>
							Soon
						</span>
						<div
							class="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500"
						>
							<svelte:component this={getIcon(preset.icon)} size={22} />
						</div>
						<div>
							<p class="text-sm font-bold text-zinc-400">{preset.name}</p>
							<p class="mt-0.5 text-xs text-zinc-500">{preset.description}</p>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</section>

	<!-- Sets table -->
	<section>
		<h2 class="mb-4 text-sm font-semibold tracking-widest text-zinc-400 uppercase">
			Your game sets
		</h2>

		{#if data.sets.length === 0}
			<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-500">
				No game sets yet. Pick a preset above to get started.
			</div>
		{:else}
			<div class="overflow-hidden rounded-xl border border-zinc-800">
				<table class="w-full text-sm">
					<thead class="border-b border-zinc-800 bg-zinc-900">
						<tr>
							<th class="px-4 py-3 text-left font-semibold text-zinc-400">Name</th>
							<th class="px-4 py-3 text-left font-semibold text-zinc-400">Status</th>
							<th class="px-4 py-3 text-right font-semibold text-zinc-400">Teams</th>
							<th class="px-4 py-3 text-right font-semibold text-zinc-400">Challenges</th>
							<th class="px-4 py-3 text-right font-semibold text-zinc-400">Cards</th>
							<th class="px-4 py-3 text-right font-semibold text-zinc-400">Players</th>
							<th class="px-4 py-3 text-right font-semibold text-zinc-400">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-zinc-800 bg-zinc-950">
						{#each data.sets as s (s.id)}
							<tr class="hover:bg-zinc-900/50">
								<td class="px-4 py-3">
									<a
										href="/admin/sets/{s.id}"
										class="font-semibold text-white transition-colors hover:text-amber-400"
									>
										{s.name}
									</a>
									{#if s.description}
										<p class="text-xs text-zinc-500">{s.description}</p>
									{/if}
								</td>
								<td class="px-4 py-3">
									<form
										method="POST"
										action="?/toggle"
										use:enhance={() => {
											togglingId = s.id;
											return async ({ update }) => {
												await update();
												togglingId = null;
											};
										}}
									>
										<input type="hidden" name="id" value={s.id} />
										<button
											type="submit"
											disabled={togglingId === s.id}
											class="cursor-pointer rounded-full px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-70 disabled:opacity-40 {STATUS_BADGE[
												s.status
											] ?? 'bg-zinc-700 text-zinc-300'}"
											title="Click to toggle"
										>
											{togglingId === s.id ? '…' : s.status}
										</button>
									</form>
								</td>
								<td class="px-4 py-3 text-right text-zinc-300">{s.team_count}</td>
								<td class="px-4 py-3 text-right text-zinc-300">{s.challenge_count}</td>
								<td class="px-4 py-3 text-right text-zinc-300">{s.card_count}</td>
								<td class="px-4 py-3 text-right text-zinc-300">{s.player_count}</td>
								<td class="px-4 py-3 text-right">
									<div class="flex items-center justify-end gap-2">
										<a
											href="/admin/sets/{s.id}"
											class="rounded px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:text-white"
										>
											Edit
										</a>
										{#if s.status === 'active'}
											<a
												href="/admin/sets/{s.id}/lobby"
												class="rounded px-2 py-1 text-xs font-medium text-amber-400 transition-colors hover:text-amber-300"
											>
												Lobby
											</a>
										{/if}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style>
	:global(.admin-label) {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: #a1a1aa;
		margin-bottom: 0.375rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	:global(.admin-input) {
		width: 100%;
		background: #18181b;
		border: 1px solid #3f3f46;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
		color: #f4f4f5;
		font-size: 0.875rem;
		transition: border-color 0.15s;
	}
	:global(.admin-input:focus) {
		outline: none;
		border-color: #fbbf24;
	}
</style>
