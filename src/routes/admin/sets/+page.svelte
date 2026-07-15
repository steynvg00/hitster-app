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

	// S1: icon-badge colour per preset, for the row's icon badge — mirrors the
	// challenges list's getTypeColor(variant) treatment (a lighter /10-/20
	// opacity tint, distinct from the pill badge's heavier /60 background).
	// Same colour FAMILY as PRESET_BADGE above so a preset's icon and its badge
	// always agree; same custom/unmatched-slug fallback as presetBadge() below.
	const PRESET_ICON_COLOR: Record<string, string> = {
		normal: 'bg-zinc-700/40 text-zinc-300',
		party: 'bg-pink-900/20 text-pink-400',
		token_shop: 'bg-amber-900/20 text-amber-400',
		quick_game: 'bg-cyan-900/20 text-cyan-400',
		marathon: 'bg-emerald-900/20 text-emerald-400'
	};

	function presetBadge(slug: string | null) {
		if (!slug || slug === 'custom') return { label: 'Custom', cls: 'bg-zinc-800 text-zinc-400' };
		return PRESET_BADGE[slug] ?? { label: slug, cls: 'bg-zinc-800 text-zinc-400' };
	}

	function presetIconColor(slug: string | null): string {
		if (!slug || slug === 'custom') return 'bg-zinc-800 text-zinc-400';
		return PRESET_ICON_COLOR[slug] ?? 'bg-zinc-800 text-zinc-400';
	}

	// Same custom/unmatched-slug fallback as presetBadge(): setPresets' own
	// 'custom' entry (icon: FilePlus2) always exists, so this never needs a
	// hardcoded icon-name fallback of its own.
	function presetIconName(slug: string | null): string {
		const key = !slug || slug === 'custom' ? 'custom' : slug;
		return setPresets.find((p) => p.slug === key)?.icon ?? 'FilePlus2';
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

<!--
	S1: sets-page unification. Outer padding, header shape (title+subtitle left,
	"+ new" button right, same classes as /admin/challenges), and the filter row
	now match the challenges list's shell. The old layout was p-8 wrapper, a
	title-only header, a separate full-width dashed "+ Create new gameset"
	block, and a <section><h2>Your game sets</h2> with filters pushed ml-auto>
	wrapper around a <table>. None of that structure carries data — it's been
	flattened to the SAME shape challenges uses. The URL-bound ?preset/?status/
	?sort wiring, the preset badges, the create Modal, and both empty states
	are UNCHANGED — only their container/positioning moved.
-->
<div class="p-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-white">Game Sets</h1>
			<p class="mt-0.5 text-sm text-zinc-400">Manage rounds and team randomization.</p>
		</div>
		<button
			onclick={() => (modalOpen = true)}
			class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
		>
			+ New Set
		</button>
	</div>

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}

	<!-- Filter / sort controls — same row shape as challenges. No search box:
	     sets never had one, and this is visual alignment, not a new filter. -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
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
		<select
			value={data.statusFilter ?? ''}
			onchange={(e) => setParam('status', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="">All statuses</option>
			<option value="active">Active</option>
			<option value="inactive">Inactive</option>
		</select>
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
				<p class="mt-1 text-sm text-zinc-500">Click "+ New Set" above to get started</p>
			</div>
		{/if}
	{:else}
		<!-- S1: row style mirrors /admin/challenges' list row (icon badge, title +
		     badges, meta line, right-aligned actions) — was a <table>. NOT
		     extracted into a shared row component: the content differs too much
		     to share cleanly (variant icon/type-badge/plain-status-text/single
		     meta-line vs preset icon/preset-badge/status-TOGGLE-button/three
		     numeric counts) — mirrored the container classes/structure instead,
		     per the same "mirror it" call C2 made for FragmentsEditor/
		     StandardEditor's clip row. Every existing behaviour is preserved:
		     row-click nav, the status click-to-toggle (still a form + button,
		     just restyled to badge sizing), the preset badge, and the
		     conditional Lobby link. -->
		<div class="space-y-2">
			{#each data.sets as s (s.id)}
				<div
					role="button"
					tabindex="0"
					onclick={() => goto(`/admin/sets/${s.id}`)}
					onkeydown={(e) => e.key === 'Enter' && goto(`/admin/sets/${s.id}`)}
					class="flex cursor-pointer items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
				>
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {presetIconColor(
							s.preset_slug
						)}"
					>
						<svelte:component this={getIcon(presetIconName(s.preset_slug))} size={16} />
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="font-medium text-white">{s.name}</span>
							<span
								class="rounded px-2 py-0.5 text-xs font-medium {presetBadge(s.preset_slug).cls}"
							>
								{presetBadge(s.preset_slug).label}
							</span>
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
									onclick={(e) => e.stopPropagation()}
									class="cursor-pointer rounded px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-40 {STATUS_BADGE[
										s.status
									] ?? 'bg-zinc-700 text-zinc-300'}"
									title="Click to toggle"
								>
									{togglingId === s.id ? '…' : s.status}
								</button>
							</form>
						</div>
						<div class="mt-0.5 flex items-center gap-3 text-xs text-zinc-500">
							{#if s.description}
								<span class="truncate">{s.description}</span>
								<span>·</span>
							{/if}
							<span>{s.team_count} team{s.team_count !== 1 ? 's' : ''}</span>
							<span>·</span>
							<span>{s.challenge_count} challenge{s.challenge_count !== 1 ? 's' : ''}</span>
							<span>·</span>
							<span>{s.player_count} player{s.player_count !== 1 ? 's' : ''}</span>
						</div>
					</div>

					<a
						href="/admin/sets/{s.id}"
						onclick={(e) => e.stopPropagation()}
						class="shrink-0 rounded px-2 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-zinc-800 hover:text-amber-300"
					>
						Edit
					</a>
					{#if s.status === 'active'}
						<a
							href="/admin/sets/{s.id}/lobby"
							onclick={(e) => e.stopPropagation()}
							class="shrink-0 rounded px-2 py-1 text-xs font-medium text-cyan-400 transition-colors hover:bg-zinc-800 hover:text-cyan-300"
						>
							Lobby
						</a>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
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
