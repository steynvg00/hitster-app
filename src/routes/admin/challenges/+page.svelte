<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatTimer } from '$lib/challenge-timer';
	import { goto } from '$app/navigation';
	import type { PageData, ActionData } from './$types';
	import { CHALLENGE_TYPES, getTypeIcon, getTypeColor, getTypeDescription } from '$lib/variants';
	import Modal from '$lib/components/ui/Modal.svelte';
	import { ListMusic, Guitar } from 'lucide-svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let showCreate = $state(false);

	$effect(() => {
		if (form?.success) showCreate = false;
	});

	const statusColor: Record<string, string> = {
		draft: 'text-zinc-400 bg-zinc-800',
		active: 'text-green-400 bg-green-900/40',
		completed: 'text-blue-400 bg-blue-900/40'
	};

	const TYPE_LABELS: Record<string, string> = {
		standard: 'Standard',
		anthem: 'Anthem',
		label: 'Label',
		mashup: 'Mashup',
		fragments: 'Fragments'
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
		!!(data.q || data.typeFilter || data.statusFilter || data.hasTabsFilter !== 'all')
	);
</script>

<div class="p-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-white">Challenges</h1>
			<p class="mt-0.5 text-sm text-zinc-400">{data.challenges.length} challenges</p>
		</div>
		<button
			onclick={() => (showCreate = true)}
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

	<!-- Filter / sort controls -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<input
			value={searchQuery}
			oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
			placeholder="Search by name…"
			class="min-w-[180px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:border-amber-400 focus:outline-none"
		/>
		<select
			value={data.typeFilter}
			onchange={(e) => setParam('type', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="">All types</option>
			{#each CHALLENGE_TYPES as t (t)}
				<option value={t}>{TYPE_LABELS[t] ?? t}</option>
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
			value={data.hasTabsFilter}
			onchange={(e) => setParam('has_tabs', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="all">Any tabs</option>
			<option value="yes">Has tabs</option>
			<option value="no">No tabs</option>
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
			<option value="type_asc">Type A→Z</option>
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
				<p class="mt-1 text-sm text-zinc-500">Click "+ New Challenge" to create your first one</p>
			</div>
		{/if}
	{:else}
		<div class="space-y-2">
			{#each data.challenges as challenge (challenge.id)}
				<div
					role="button"
					tabindex="0"
					onclick={() => goto(`/admin/challenges/${challenge.id}`)}
					onkeydown={(e) => e.key === 'Enter' && goto(`/admin/challenges/${challenge.id}`)}
					class="flex cursor-pointer items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
				>
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {getTypeColor(
							challenge.variant
						)}"
					>
						<svelte:component this={getTypeIcon(challenge.variant)} size={16} />
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="font-medium text-white">{challenge.title}</span>
							<span class="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-500"
								>{TYPE_LABELS[challenge.variant] ?? challenge.variant}</span
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
							<span>{challenge.tabCount} tab{challenge.tabCount !== 1 ? 's' : ''}</span>
							<span>·</span>
							<span
								>{challenge.submissionCount} submission{challenge.submissionCount !== 1
									? 's'
									: ''}</span
							>
							<span>·</span>
							<span>{formatTimer(challenge.timer_seconds)} timer</span>
						</div>
					</div>

					<a
						href="/admin/challenges/{challenge.id}"
						onclick={(e) => e.stopPropagation()}
						class="shrink-0 rounded px-2 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-zinc-800 hover:text-amber-300"
					>
						Edit
					</a>

					<form method="POST" action="?/delete" use:enhance>
						<input type="hidden" name="id" value={challenge.id} />
						<button
							type="submit"
							onclick={(e) => {
								e.stopPropagation();
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

<!-- Create modal: pick a challenge type -->
{#if showCreate}
	<Modal title="New Challenge" onclose={() => (showCreate = false)}>
		<p class="mb-5 text-sm text-zinc-400">Choose a challenge type to get started.</p>
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each CHALLENGE_TYPES as type (type)}
				{@const Icon = getTypeIcon(type)}
				<form method="POST" action="?/createChallenge" use:enhance class="contents">
					<input type="hidden" name="type" value={type} />
					<button
						type="submit"
						class="flex flex-col items-start gap-2 rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-left transition-all hover:border-amber-400/50 hover:bg-zinc-800"
					>
						<div class="flex h-9 w-9 items-center justify-center rounded-lg {getTypeColor(type)}">
							<svelte:component this={Icon} size={18} />
						</div>
						<div>
							<div class="font-semibold text-white">{TYPE_LABELS[type]}</div>
							<div class="mt-0.5 text-xs text-zinc-500">{getTypeDescription(type)}</div>
						</div>
					</button>
				</form>
			{/each}
			<form method="POST" action="?/createChallenge" use:enhance class="contents">
				<input type="hidden" name="type" value="instrument" />
				<button
					type="submit"
					class="flex flex-col items-start gap-2 rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-left transition-all hover:border-amber-400/50 hover:bg-zinc-800"
				>
					<div
						class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-900/20 text-emerald-400"
					>
						<Guitar size={18} />
					</div>
					<div>
						<div class="font-semibold text-white">Instrument</div>
						<div class="mt-0.5 text-xs text-zinc-500">
							Identify the artist from a sound · Artist
						</div>
					</div>
				</button>
			</form>
		</div>
	</Modal>
{/if}
