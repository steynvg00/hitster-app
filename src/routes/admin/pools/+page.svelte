<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type PoolKey = 'artists' | 'labels' | 'festivals' | 'vocal_sources';

	const TABS: { key: PoolKey; label: string }[] = [
		{ key: 'artists',       label: 'Artists' },
		{ key: 'labels',        label: 'Labels' },
		{ key: 'festivals',     label: 'Festivals' },
		{ key: 'vocal_sources', label: 'Vocal Sources' }
	];

	let editingId = $state<string | null>(null);
	let addingNew = $state(false);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const f = $derived(form as any);

	$effect(() => {
		if (f?.success) {
			editingId = null;
			addingNew = false;
		}
	});
</script>

<div class="p-6 max-w-2xl">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-white">Answer Pools</h1>
		<p class="mt-0.5 text-sm text-zinc-400">Global combobox options — shared across all challenges</p>
	</div>

	{#if f?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			{f.error}
		</div>
	{/if}

	<!-- Tab bar -->
	<div class="mb-6 flex gap-1 border-b border-zinc-800">
		{#each TABS as tab}
			<a
				href="?pool={tab.key}"
				class="rounded-t-lg px-4 py-2 text-sm font-medium transition-colors
					{data.active === tab.key
						? 'bg-zinc-900 border border-b-zinc-900 border-zinc-800 text-amber-400 -mb-px'
						: 'text-zinc-500 hover:text-zinc-300'}"
			>
				{tab.label}
			</a>
		{/each}
	</div>

	{#if data.loadError}
		<p class="text-sm text-red-400">Failed to load: {data.loadError}</p>
	{:else}
		<div class="rounded-xl border border-zinc-800 bg-zinc-900">
			<!-- Add new -->
			<div class="border-b border-zinc-800 p-4">
				{#if addingNew}
					<form method="POST" action="?/add&pool={data.active}" use:enhance class="flex gap-2">
						<input type="hidden" name="pool" value={data.active} />
						<input
							name="name"
							placeholder="New entry…"
							required
							autofocus
							class="input-field flex-1 text-sm"
						/>
						<button type="submit" class="btn-primary text-sm">Add</button>
						<button type="button" onclick={() => (addingNew = false)} class="btn-ghost text-sm">Cancel</button>
					</form>
				{:else}
					<button
						onclick={() => (addingNew = true)}
						class="text-sm font-medium text-amber-400 transition-colors hover:text-amber-300"
					>
						+ Add entry
					</button>
				{/if}
			</div>

			<!-- Entry list -->
			{#if data.entries.length === 0}
				<p class="p-4 text-sm text-zinc-600">No entries yet.</p>
			{:else}
				<div class="divide-y divide-zinc-800">
					{#each data.entries as entry (entry.id)}
						<div class="flex items-center gap-3 px-4 py-2.5">
							{#if editingId === entry.id}
								<form method="POST" action="?/update" use:enhance class="flex flex-1 gap-2">
									<input type="hidden" name="pool" value={data.active} />
									<input type="hidden" name="id" value={entry.id} />
									<input
										name="name"
										value={entry.name}
										required
										class="input-field flex-1 text-sm"
									/>
									<button type="submit" class="btn-primary text-xs">Save</button>
									<button
										type="button"
										onclick={() => (editingId = null)}
										class="btn-ghost text-xs"
									>
										Cancel
									</button>
								</form>
							{:else}
								<span class="flex-1 text-sm text-zinc-200">{entry.name}</span>
								<button
									onclick={() => (editingId = entry.id)}
									class="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
								>
									Edit
								</button>
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="pool" value={data.active} />
									<input type="hidden" name="id" value={entry.id} />
									<button
										type="submit"
										onclick={(e) => {
											if (!confirm(`Remove "${entry.name}"?`)) e.preventDefault();
										}}
										class="text-xs text-red-700 transition-colors hover:text-red-400"
									>
										Delete
									</button>
								</form>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Footer -->
			<div class="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-600">
				{data.entries.length} {data.entries.length === 1 ? 'entry' : 'entries'}
			</div>
		</div>
	{/if}
</div>

<style>
	:global(.input-field) {
		background: #27272a; border: 1px solid #3f3f46; border-radius: 0.5rem;
		padding: 0.5rem 0.75rem; color: #f4f4f5; font-size: 0.875rem; width: 100%;
		transition: border-color 0.15s;
	}
	:global(.input-field:focus) { outline: none; border-color: #fbbf24; }
	:global(.btn-primary) {
		background: #fbbf24; color: #09090b; font-weight: 700;
		padding: 0.4rem 1rem; border-radius: 0.5rem; font-size: 0.875rem;
		transition: background 0.15s; white-space: nowrap;
	}
	:global(.btn-primary:hover) { background: #fcd34d; }
	:global(.btn-ghost) {
		background: transparent; border: 1px solid #3f3f46; color: #a1a1aa;
		font-weight: 500; padding: 0.4rem 1rem; border-radius: 0.5rem;
		font-size: 0.875rem; transition: all 0.15s;
	}
	:global(.btn-ghost:hover) { border-color: #71717a; color: #f4f4f5; }
</style>
