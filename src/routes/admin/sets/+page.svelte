<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData, ActionData } from './$types';
	import { setPresets } from '$lib/presets/setPresets';
	import Modal from '$lib/components/ui/Modal.svelte';
	import * as LucideIcons from 'lucide-svelte';
	import { PackageOpen } from 'lucide-svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let modalOpen = $state(false);
	let creatingSlug = $state<string | null>(null);
	let togglingId = $state<string | null>(null);

	const readyPresets = setPresets.filter((p) => p.status === 'ready');

	const STATUS_BADGE: Record<string, string> = {
		inactive: 'bg-zinc-700 text-zinc-300',
		active: 'bg-green-900/60 text-green-400'
	};

	const PRESET_BADGE: Record<string, { label: string; cls: string }> = {
		normal: { label: 'Normal', cls: 'bg-zinc-700 text-zinc-300' },
		party: { label: 'Party', cls: 'bg-pink-900/60 text-pink-400' },
		token_shop: { label: 'Token Shop', cls: 'bg-amber-900/60 text-amber-400' },
		quick_game: { label: 'Quick Game', cls: 'bg-cyan-900/60 text-cyan-400' },
		marathon: { label: 'Marathon', cls: 'bg-emerald-900/60 text-emerald-400' }
	};

	function presetBadge(slug: string | null) {
		if (!slug || slug === 'custom') return { label: 'Custom', cls: 'bg-zinc-800 text-zinc-400' };
		return PRESET_BADGE[slug] ?? { label: slug, cls: 'bg-zinc-800 text-zinc-400' };
	}

	function getIcon(name: string) {
		return (LucideIcons as Record<string, unknown>)[name] as typeof LucideIcons.Sparkles;
	}

	function setParam(key: string, value: string) {
		const u = new URL(location.href);
		if (value) u.searchParams.set(key, value);
		else u.searchParams.delete(key);
		goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true });
	}

	const hasFilters = $derived(!!(data.presetFilter || data.statusFilter));
</script>

<svelte:head>
	<title>Game Sets — Admin</title>
</svelte:head>

<div class="p-8">
	<div class="mb-6">
		<h1 class="text-2xl font-black text-white">Game Sets</h1>
		<p class="mt-0.5 text-sm text-zinc-400">Manage rounds and team randomization.</p>
	</div>

	{#if form?.error}
		<p class="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-2 text-sm text-red-400">
			{form.error}
		</p>
	{/if}

	<!-- Create button -->
	<div class="mb-8">
		<button
			onclick={() => (modalOpen = true)}
			class="w-full rounded-xl border border-dashed border-zinc-600 bg-zinc-900 py-4 text-sm font-semibold text-zinc-300 transition-colors hover:border-amber-400/60 hover:bg-zinc-800 hover:text-amber-400"
		>
			+ Create new gameset
		</button>
	</div>

	<!-- Sets section -->
	<section>
		<div class="mb-4 flex flex-wrap items-center gap-3">
			<h2 class="text-sm font-semibold tracking-widest text-zinc-400 uppercase">Your game sets</h2>

			<div class="ml-auto flex flex-wrap items-center gap-2">
				<!-- Preset filter -->
				<select
					value={data.presetFilter ?? ''}
					onchange={(e) => setParam('preset', (e.target as HTMLSelectElement).value)}
					class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
				>
					<option value="">All presets</option>
					{#each readyPresets as p (p.slug)}
						<option value={p.slug}>{p.name}</option>
					{/each}
				</select>

				<!-- Status filter -->
				<select
					value={data.statusFilter ?? ''}
					onchange={(e) => setParam('status', (e.target as HTMLSelectElement).value)}
					class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
				>
					<option value="">All statuses</option>
					<option value="active">Active</option>
					<option value="inactive">Inactive</option>
				</select>

				<!-- Sort -->
				<select
					value={data.sort}
					onchange={(e) => setParam('sort', (e.target as HTMLSelectElement).value)}
					class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
				>
					<option value="newest">Newest first</option>
					<option value="oldest">Oldest first</option>
					<option value="name_asc">Name A→Z</option>
					<option value="name_desc">Name Z→A</option>
				</select>
			</div>
		</div>

		{#if data.sets.length === 0}
			{#if hasFilters}
				<!-- Filtered empty state -->
				<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
					<p class="text-sm font-semibold text-zinc-400">No sets match the current filters</p>
					<a
						href="/admin/sets"
						class="mt-3 inline-block rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
					>
						Clear filters
					</a>
				</div>
			{:else}
				<!-- True empty state -->
				<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-14 text-center">
					<PackageOpen size={64} class="mx-auto mb-4 text-zinc-700" />
					<p class="text-base font-bold text-zinc-300">No game sets yet</p>
					<p class="mt-1 text-sm text-zinc-500">Click "Create new gameset" above to get started</p>
				</div>
			{/if}
		{:else}
			<div class="overflow-hidden rounded-xl border border-zinc-800">
				<table class="w-full text-sm">
					<thead class="border-b border-zinc-800 bg-zinc-900">
						<tr>
							<th class="px-4 py-3 text-left font-semibold text-zinc-400">Name</th>
							<th class="px-4 py-3 text-left font-semibold text-zinc-400">Preset</th>
							<th class="px-4 py-3 text-left font-semibold text-zinc-400">Status</th>
							<th class="px-4 py-3 text-right font-semibold text-zinc-400">Teams</th>
							<th class="px-4 py-3 text-right font-semibold text-zinc-400">Challenges</th>
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
									<span
										class="rounded-full px-2 py-0.5 text-[11px] font-semibold {presetBadge(
											s.preset_slug
										).cls}"
									>
										{presetBadge(s.preset_slug).label}
									</span>
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

<!-- Preset picker modal -->
{#if modalOpen}
	<Modal title="Choose a preset" onclose={() => (modalOpen = false)}>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{#each setPresets as preset (preset.slug)}
				{#if preset.status === 'ready'}
					<form
						method="POST"
						action="?/createFromPreset"
						use:enhance={() => {
							creatingSlug = preset.slug;
							return async ({ update }) => {
								creatingSlug = null;
								modalOpen = false;
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
	</Modal>
{/if}

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
