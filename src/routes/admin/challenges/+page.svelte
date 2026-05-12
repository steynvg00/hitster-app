<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData, ActionData } from './$types';
	import { VARIANTS, getVariantIcon, getVariantColor } from '$lib/variants';
	import { ListMusic } from 'lucide-svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const DEFAULT_POINTS: Record<string, object> = {
		normal: { artist: 5, title: 5, year: { exact: 10, off1: 5, off2: 2 } },
		label: { label: 10 },
		anthem: { festival: 5, artist: 5, title: 5, year: { exact: 10, off1: 5, off2: 2 } },
		vocal: { vocal_source: 15 },
		fragments: { correct_order: 20 },
		kick: { per_correct: 5 },
		mashup: { per_correct: 5 },
		battle: { winner: 20, closest: 10 }
	};

	let showCreate = $state(false);
	let newVariant = $state('normal');
	let pointsJson = $state(JSON.stringify(DEFAULT_POINTS['normal'], null, 2));

	$effect(() => {
		pointsJson = JSON.stringify(DEFAULT_POINTS[newVariant] ?? {}, null, 2);
	});

	$effect(() => {
		if (form?.success) showCreate = false;
	});

	const statusColor: Record<string, string> = {
		draft: 'text-zinc-400 bg-zinc-800',
		active: 'text-green-400 bg-green-900/40',
		completed: 'text-blue-400 bg-blue-900/40'
	};

	function setParam(key: string, value: string) {
		const u = new URL(location.href);
		if (value) u.searchParams.set(key, value);
		else u.searchParams.delete(key);
		goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true });
	}

	let searchQuery = $state(data.q);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	function onSearchInput(val: string) {
		searchQuery = val;
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => setParam('q', val), 300);
	}

	const hasFilters = $derived(
		!!(data.q || data.variantFilter || data.statusFilter || data.hasTracksFilter !== 'all')
	);
</script>

<div class="p-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-white">Challenges</h1>
			<p class="mt-0.5 text-sm text-zinc-400">{data.challenges.length} challenges</p>
		</div>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
		>
			+ New Challenge
		</button>
	</div>

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}

	<!-- Create form -->
	{#if showCreate}
		<div class="mb-6 rounded-xl border border-amber-400/30 bg-zinc-900 p-5">
			<h2 class="mb-4 text-sm font-semibold tracking-widest text-amber-400 uppercase">
				New Challenge
			</h2>
			<form method="POST" action="?/create" use:enhance class="space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<input name="title" placeholder="Challenge name *" required class="input-field" />
					<input
						name="stage_label"
						placeholder="Stage label (e.g. Blue: Raw)"
						class="input-field"
					/>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="mb-1 block text-xs text-zinc-400">Variant *</label>
						<select name="variant" bind:value={newVariant} required class="input-field">
							{#each VARIANTS as v (v)}
								<option value={v}>{v}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="mb-1 block text-xs text-zinc-400">Timer (seconds)</label>
						<input
							name="timer_seconds"
							type="number"
							value="60"
							min="10"
							max="600"
							class="input-field"
						/>
					</div>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Points config (JSON)</label>
					<textarea
						name="points_config"
						bind:value={pointsJson}
						rows="4"
						class="input-field font-mono text-xs"
					></textarea>
				</div>
				<div class="flex justify-end gap-2">
					<button type="button" onclick={() => (showCreate = false)} class="btn-ghost"
						>Cancel</button
					>
					<button type="submit" class="btn-primary">Create & Edit</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Filter / sort controls -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<input
			value={searchQuery}
			oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
			placeholder="Search by name…"
			class="min-w-[180px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:border-amber-400 focus:outline-none"
		/>
		<select
			value={data.variantFilter}
			onchange={(e) => setParam('variant', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="">All variants</option>
			{#each VARIANTS as v (v)}
				<option value={v}>{v}</option>
			{/each}
		</select>
		<select
			value={data.statusFilter}
			onchange={(e) => setParam('status', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="">All statuses</option>
			<option value="draft">Draft</option>
			<option value="active">Active</option>
			<option value="completed">Completed</option>
		</select>
		<select
			value={data.hasTracksFilter}
			onchange={(e) => setParam('has_tracks', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="all">Any tracks</option>
			<option value="yes">Has tracks</option>
			<option value="no">No tracks</option>
		</select>
		<select
			value={data.sort}
			onchange={(e) => setParam('sort', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="created_desc">Newest first</option>
			<option value="created_asc">Oldest first</option>
			<option value="name_asc">Name A→Z</option>
			<option value="name_desc">Name Z→A</option>
			<option value="variant_asc">Variant A→Z</option>
		</select>
	</div>

	<!-- Challenge list -->
	{#if data.challenges.length === 0}
		{#if hasFilters}
			<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
				<p class="text-sm font-semibold text-zinc-400">No challenges match the current filters</p>
				<a
					href="/admin/challenges"
					class="mt-3 inline-block rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
				>
					Clear filters
				</a>
			</div>
		{:else}
			<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-14 text-center">
				<ListMusic size={64} class="mx-auto mb-4 text-zinc-700" />
				<p class="text-base font-bold text-zinc-300">No challenges yet</p>
				<p class="mt-1 text-sm text-zinc-500">
					Click "+ New Challenge" above to create your first one
				</p>
			</div>
		{/if}
	{:else}
		<div class="space-y-2">
			{#each data.challenges as challenge (challenge.id)}
				<div
					class="flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-700"
				>
					<!-- Variant icon badge -->
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {getVariantColor(
							challenge.variant
						)}"
					>
						<svelte:component this={getVariantIcon(challenge.variant)} size={16} />
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="font-medium text-white">{challenge.title}</span>
							<span class="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-500"
								>{challenge.variant}</span
							>
							<span
								class="rounded px-2 py-0.5 text-xs font-medium {statusColor[challenge.status] ??
									'text-zinc-400'}"
							>
								{challenge.status}
							</span>
						</div>
						<div class="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
							{#if challenge.stage_label}
								<span>{challenge.stage_label}</span>
								<span>·</span>
							{/if}
							<span>{challenge.trackCount} track{challenge.trackCount !== 1 ? 's' : ''}</span>
							<span>·</span>
							<span
								>{challenge.submissionCount} submission{challenge.submissionCount !== 1
									? 's'
									: ''}</span
							>
							<span>·</span>
							<span>{challenge.timer_seconds}s timer</span>
						</div>
					</div>

					<a
						href="/admin/challenges/{challenge.id}"
						class="shrink-0 text-sm font-medium text-amber-400 transition-colors hover:text-amber-300"
					>
						Edit →
					</a>

					<form method="POST" action="?/delete" use:enhance>
						<input type="hidden" name="id" value={challenge.id} />
						<button
							type="submit"
							onclick={(e) => {
								if (!confirm(`Delete "${challenge.title}"?`)) e.preventDefault();
							}}
							class="rounded px-2 py-1 text-sm text-red-700 transition-colors hover:bg-zinc-800 hover:text-red-400"
						>
							✕
						</button>
					</form>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	:global(.input-field) {
		background: #27272a;
		border: 1px solid #3f3f46;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
		color: #f4f4f5;
		font-size: 0.875rem;
		width: 100%;
		transition: border-color 0.15s;
	}
	:global(.input-field:focus) {
		outline: none;
		border-color: #fbbf24;
	}
	:global(.btn-primary) {
		background: #fbbf24;
		color: #09090b;
		font-weight: 700;
		padding: 0.4rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		transition: background 0.15s;
	}
	:global(.btn-primary:hover) {
		background: #fcd34d;
	}
	:global(.btn-ghost) {
		background: transparent;
		border: 1px solid #3f3f46;
		color: #a1a1aa;
		font-weight: 500;
		padding: 0.4rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		transition: all 0.15s;
	}
	:global(.btn-ghost:hover) {
		border-color: #71717a;
		color: #f4f4f5;
	}
</style>
