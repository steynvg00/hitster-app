<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const gs = $derived(data.gameSet);
	const isActive = $derived(gs.status === 'active');

	// Live play_state — updated via realtime when host clicks "Start the game"
	let livePlayState = $state<'joining' | 'playing' | 'recap'>(data.gameSet.play_state ?? 'joining');

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`set-page-${data.gameSet.id}`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'game_sets', filter: `id=eq.${data.gameSet.id}` },
				(payload) => {
					if (payload.new.play_state) livePlayState = payload.new.play_state as typeof livePlayState;
				}
			)
			.subscribe();
		return () => supabaseBrowser.removeChannel(channel);
	});

	// ── Challenge picker state ────────────────────────────────────────────────
	// Build the ordered list of selected challenge IDs from the loaded set_challenges
	let selected = $state<string[]>(data.setChallenges.map((sc) => sc.challenge_id));

	// Available = all challenges not yet selected
	const available = $derived(
		data.allChallenges.filter((c) => !selected.includes(c.id))
	);

	function add(id: string) {
		if (!selected.includes(id)) selected = [...selected, id];
	}
	function remove(id: string) {
		selected = selected.filter((s) => s !== id);
	}
	function moveUp(idx: number) {
		if (idx === 0) return;
		const arr = [...selected];
		[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
		selected = arr;
	}
	function moveDown(idx: number) {
		if (idx >= selected.length - 1) return;
		const arr = [...selected];
		[arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
		selected = arr;
	}

	// Drag-to-reorder
	let dragIdx = $state<number | null>(null);

	function onDragStart(idx: number) { dragIdx = idx; }
	function onDrop(idx: number) {
		if (dragIdx === null || dragIdx === idx) return;
		const arr = [...selected];
		const [item] = arr.splice(dragIdx, 1);
		arr.splice(idx, 0, item);
		selected = arr;
		dragIdx = null;
	}

	function challengeTitle(id: string) {
		return data.allChallenges.find((c) => c.id === id)?.title ?? id;
	}
	function challengeVariant(id: string) {
		return data.allChallenges.find((c) => c.id === id)?.variant ?? '';
	}

	// ── Card state ────────────────────────────────────────────────────────────
	let newSlug = $state('');
	let savingChallenges = $state(false);
</script>

<svelte:head>
	<title>{gs.name} — Admin Sets</title>
</svelte:head>

<div class="p-8 max-w-4xl">
	<!-- Header -->
	<div class="mb-6 flex items-start justify-between gap-4">
		<div>
			<a href="/admin/sets" class="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← Sets</a>
			<h1 class="mt-1 text-2xl font-black text-white">{gs.name}</h1>
			<span class="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold
				{isActive ? 'bg-green-900/60 text-green-400' : 'bg-zinc-700 text-zinc-300'}">
				{gs.status}
			</span>
		</div>
		<div class="flex gap-2 shrink-0">
			{#if isActive}
				<a
					href="/admin/sets/{gs.id}/lobby"
					class="rounded-lg bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-400 hover:bg-amber-400/25 transition-colors"
				>
					View Lobby
				</a>
			{/if}
			{#if isActive && livePlayState === 'joining'}
				<form method="POST" action="?/startGame" use:enhance>
					<button
						type="submit"
						class="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 transition-colors"
					>
						Start the game →
					</button>
				</form>
			{:else if isActive && livePlayState === 'playing'}
				<span class="rounded-lg bg-green-900/40 px-4 py-2 text-sm font-semibold text-green-400">
					Game in progress
				</span>
			{/if}
			{#if livePlayState === 'recap' || gs.recap_state}
				<a
					href="/admin/sets/{gs.id}/recap"
					class="rounded-lg bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-400 hover:bg-amber-400/25 transition-colors"
				>
					Recap →
				</a>
			{/if}
			{#if isActive && livePlayState === 'playing'}
				<form method="POST" action="?/startRecap" use:enhance
					onsubmit={(e) => { if (!confirm('Start recap? Players will be redirected to the waiting screen.')) e.preventDefault(); }}>
					<button
						type="submit"
						class="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 transition-colors"
					>
						Start Recap
					</button>
				</form>
			{/if}
			<form method="POST" action="?/toggle" use:enhance={() => async ({ update }) => update({ reset: false })}
				onsubmit={(e) => {
					if (isActive) return; // deactivating — no confirm needed
					const count = gs.expected_player_count;
					if (count && count > 0 && count % gs.team_count !== 0) {
						const base = Math.floor(count / gs.team_count);
						const extra = count % gs.team_count;
						const msg = `Uneven distribution — ${extra} team${extra > 1 ? 's' : ''} will have ${base + 1} players and ${gs.team_count - extra} will have ${base}. Continue?`;
						if (!confirm(msg)) e.preventDefault();
					}
				}}>
				<button
					type="submit"
					class="{isActive
						? 'rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 hover:border-zinc-500 hover:text-white'
						: 'rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600'} transition-colors"
				>
					{isActive ? 'Set Inactive' : 'Set Active'}
				</button>
			</form>
			{#if !isActive}
				<form method="POST" action="?/delete" use:enhance
					onsubmit={(e) => { if (!confirm(`Delete "${gs.name}"? This cannot be undone.`)) e.preventDefault(); }}>
					<button
						type="submit"
						class="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-500 hover:border-red-800 hover:text-red-400 transition-colors"
					>
						Delete
					</button>
				</form>
			{/if}
		</div>
	</div>

	{#if form?.error}
		{@const f = form as unknown as { existingTagUrl?: string | null; existingTagPurpose?: string | null }}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
			{form.error}
			{#if f.existingTagUrl}
				<a href={f.existingTagUrl} class="ml-2 underline hover:text-red-300"
					>View existing {f.existingTagPurpose ?? ''} tag →</a>
			{/if}
		</div>
	{/if}
	{#if form?.success}
		<div class="mb-4 rounded-lg border border-green-800 bg-green-950/40 px-4 py-3 text-sm text-green-400">
			Saved.
		</div>
	{/if}

	<!-- Details form -->
	<section class="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="mb-4 text-sm font-bold uppercase tracking-widest text-zinc-400">Details</h2>
		<form method="POST" action="?/update"
			use:enhance={() => async ({ update }) => update({ reset: false })}
			class="grid grid-cols-2 gap-4">
			<div class="col-span-2">
				<label class="admin-label" for="s-name">Name</label>
				<input id="s-name" name="name" class="admin-input" value={gs.name} required />
			</div>
			<div class="col-span-2">
				<label class="admin-label" for="s-desc">Description</label>
				<input id="s-desc" name="description" class="admin-input" value={gs.description ?? ''} />
			</div>
			<div>
				<label class="admin-label" for="s-tc">Teams (2–6)</label>
				<input id="s-tc" name="team_count" type="number" min="2" max="6" class="admin-input" value={gs.team_count} />
			</div>
			<div>
				<label class="admin-label" for="s-epc">Expected players (optional)</label>
				<input id="s-epc" name="expected_player_count" type="number" min="1" class="admin-input"
					value={gs.expected_player_count ?? ''} placeholder="leave blank" />
			</div>
			<div>
				<label class="admin-label" for="s-timer">Total Timer (minutes)</label>
				<input id="s-timer" name="total_timer_minutes" type="number" min="1" class="admin-input"
					value={gs.total_timer_seconds ? Math.round(gs.total_timer_seconds / 60) : ''} placeholder="leave blank" />
			</div>
			<div class="col-span-2">
				<button
					type="submit"
					class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-300"
				>
					Save Details
				</button>
			</div>
		</form>
	</section>

	<!-- Challenge picker -->
	<section class="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="mb-1 text-sm font-bold uppercase tracking-widest text-zinc-400">Challenges</h2>
		<p class="mb-4 text-xs text-zinc-500">Drag to reorder. Click + to add, × to remove.</p>

		{#if isActive}
			<p class="mb-3 text-xs text-amber-400">Set is active — changes take effect immediately.</p>
		{/if}

		<form
			method="POST"
			action="?/setChallenges"
			use:enhance={() => {
				savingChallenges = true;
				return async ({ update }) => {
					savingChallenges = false;
					await update();
				};
			}}
		>
			<!-- Hidden ordered list submitted on save -->
			<input type="hidden" name="challenge_ids" value={selected.join(',')} />

			<!-- Selected (ordered) list -->
			{#if selected.length > 0}
				<div class="mb-4 space-y-1">
					{#each selected as id, idx}
						<div
							draggable="true"
							role="listitem"
							ondragstart={() => onDragStart(idx)}
							ondragover={(e) => e.preventDefault()}
							ondrop={() => onDrop(idx)}
							class="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 cursor-grab active:cursor-grabbing"
						>
							<span class="text-zinc-600 select-none">⠿</span>
							<div class="flex-1 min-w-0">
								<div class="text-sm font-medium text-white truncate">{challengeTitle(id)}</div>
								<div class="text-xs text-zinc-500">{challengeVariant(id)}</div>
							</div>
							<div class="flex gap-1">
								<button
									type="button"
									onclick={() => moveUp(idx)}
									disabled={idx === 0}
									class="rounded p-1 text-zinc-500 hover:text-white disabled:opacity-20 transition-colors"
									aria-label="Move up"
								>↑</button>
								<button
									type="button"
									onclick={() => moveDown(idx)}
									disabled={idx >= selected.length - 1}
									class="rounded p-1 text-zinc-500 hover:text-white disabled:opacity-20 transition-colors"
									aria-label="Move down"
								>↓</button>
								<button
									type="button"
									onclick={() => remove(id)}
									class="rounded p-1 text-zinc-500 hover:text-red-400 transition-colors"
									aria-label="Remove"
								>×</button>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="mb-4 text-sm text-zinc-600">No challenges added yet.</p>
			{/if}

			<!-- Available challenges -->
			{#if available.length > 0}
				<div class="max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800/50">
					{#each available as c}
						<button
							type="button"
							onclick={() => add(c.id)}
							class="flex w-full items-center gap-3 border-b border-zinc-700/50 px-3 py-2 text-left last:border-0 hover:bg-zinc-700/50 transition-colors"
						>
							<span class="text-amber-400 text-sm">+</span>
							<div>
								<div class="text-sm text-white">{c.title}</div>
								<div class="text-xs text-zinc-500">{c.variant}{c.is_active ? '' : ' · inactive'}</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}

			<button
				type="submit"
				disabled={savingChallenges}
				class="mt-4 rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
			>
				{savingChallenges ? 'Saving…' : 'Save Challenge Order'}
			</button>
		</form>
	</section>

	<!-- Randomizer NFC cards -->
	<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="mb-1 text-sm font-bold uppercase tracking-widest text-zinc-400">Randomizer Cards</h2>
		<p class="mb-4 text-xs text-zinc-500">Physical NFC cards that assign players to this set.</p>

		{#if data.cards.length > 0}
			<div class="mb-4 space-y-2">
				{#each data.cards as card}
					<div class="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2">
						<span class="font-mono text-sm text-zinc-300">{card.id}</span>
						<form method="POST" action="?/removeCard" use:enhance>
							<input type="hidden" name="slug" value={card.id} />
							<button
								type="submit"
								class="text-xs text-zinc-500 hover:text-red-400 transition-colors"
							>
								Remove
							</button>
						</form>
					</div>
				{/each}
			</div>
		{:else}
			<p class="mb-4 text-sm text-zinc-600">No randomizer cards bound to this set.</p>
		{/if}

		<form method="POST" action="?/addCard" use:enhance={({ formData }) => {
			return async ({ result, update }) => {
				if (result.type !== 'failure') newSlug = '';
				await update();
			};
		}} class="flex gap-2">
			<input
				name="slug"
				bind:value={newSlug}
				class="admin-input flex-1"
				placeholder="NFC tag slug, e.g. random-stage-1"
				required
			/>
			<button
				type="submit"
				class="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-600 transition-colors"
			>
				Add
			</button>
		</form>
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
