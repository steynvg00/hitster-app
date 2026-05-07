<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let showCreate = $state(false);
	let creating = $state(false);
	let togglingId = $state<string | null>(null);

	const STATUS_BADGE: Record<string, string> = {
		inactive: 'bg-zinc-700 text-zinc-300',
		active: 'bg-green-900/60 text-green-400'
	};
</script>

<svelte:head>
	<title>Game Sets — Admin</title>
</svelte:head>

<div class="p-8">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-black text-white">Game Sets</h1>
			<p class="mt-0.5 text-sm text-zinc-400">Manage rounds and team randomization.</p>
		</div>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
		>
			+ New Set
		</button>
	</div>

	<!-- Create form -->
	{#if showCreate}
		<div class="mb-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
			<h2 class="mb-4 font-bold text-white">New Game Set</h2>
			{#if form?.error}
				<p class="mb-3 text-sm text-red-400">{form.error}</p>
			{/if}
			<form
				method="POST"
				action="?/create"
				use:enhance={() => {
					creating = true;
					return async ({ update }) => {
						creating = false;
						await update();
					};
				}}
				class="grid grid-cols-2 gap-4"
			>
				<div class="col-span-2">
					<label class="admin-label" for="new-name">Name</label>
					<input id="new-name" name="name" class="admin-input" placeholder="e.g. Round 1" required />
				</div>
				<div class="col-span-2">
					<label class="admin-label" for="new-desc">Description <span class="font-normal text-zinc-500">(optional)</span></label>
					<input id="new-desc" name="description" class="admin-input" placeholder="Brief description" />
				</div>
				<div>
					<label class="admin-label" for="new-tc">Teams (2–6)</label>
					<input id="new-tc" name="team_count" type="number" min="2" max="6" value="6" class="admin-input" />
				</div>
				<div>
					<label class="admin-label" for="new-epc">Expected players (optional)</label>
					<input id="new-epc" name="expected_player_count" type="number" min="1" class="admin-input" placeholder="leave blank" />
				</div>
				<div>
					<label class="admin-label" for="new-timer">Timer (minutes, optional)</label>
					<input id="new-timer" name="total_timer_minutes" type="number" min="1" class="admin-input" placeholder="leave blank" />
				</div>
				<div class="col-span-2 flex gap-3">
					<button
						type="submit"
						disabled={creating}
						class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
					>
						{creating ? 'Creating…' : 'Create & Edit'}
					</button>
					<button
						type="button"
						onclick={() => (showCreate = false)}
						class="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200"
					>
						Cancel
					</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Sets table -->
	{#if data.sets.length === 0}
		<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center text-zinc-500">
			No game sets yet. Create one to get started.
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
					{#each data.sets as s}
						<tr class="hover:bg-zinc-900/50">
							<td class="px-4 py-3">
								<a href="/admin/sets/{s.id}" class="font-semibold text-white hover:text-amber-400 transition-colors">
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
										class="cursor-pointer rounded-full px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-70 disabled:opacity-40 {STATUS_BADGE[s.status] ?? 'bg-zinc-700 text-zinc-300'}"
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
										class="rounded px-2 py-1 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
									>
										Edit
									</a>
									{#if s.status === 'active'}
										<a
											href="/admin/sets/{s.id}/lobby"
											class="rounded px-2 py-1 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
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
