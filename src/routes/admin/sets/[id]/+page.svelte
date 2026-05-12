<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const gs = $derived(data.gameSet);
	const isActive = $derived(gs.status === 'active');

	// Live state — updated via realtime
	let livePlayState = $state<'joining' | 'playing' | 'recap'>(data.gameSet.play_state ?? 'joining');
	let liveRecapState = $state<string>(data.gameSet.recap_state ?? 'pending');
	let livePlayerCount = $state(data.playerCount ?? 0);
	let liveRecentPlayers = $state<string[]>(data.recentPlayers ?? []);
	let liveTeamProgress = $state<Array<{ name: string; done: number; total: number }>>(
		data.teamProgress ?? []
	);
	// Track which player IDs are already counted (prevents double-counting on UPDATE events)
	const knownPlayerIds = new Set<string>(data.playerIds ?? []);

	onMount(() => {
		// game_sets UPDATE: track all console-relevant fields
		const channel = supabaseBrowser
			.channel(`set-console-${data.gameSet.id}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'game_sets',
					filter: `id=eq.${data.gameSet.id}`
				},
				(payload) => {
					type GSUpdate = {
						play_state?: string;
						recap_state?: string;
						nfc_lock_enabled?: boolean;
						randomizer_enabled?: boolean;
						status?: string;
					};
					const p = payload.new as GSUpdate;
					if (p.play_state) livePlayState = p.play_state as typeof livePlayState;
					if (p.recap_state) liveRecapState = p.recap_state;
					// Sync toggle state so both fields update after form actions
					if (p.nfc_lock_enabled !== undefined) nfcLockEnabled = p.nfc_lock_enabled;
					if (p.randomizer_enabled !== undefined) randomizerEnabled = p.randomizer_enabled;
				}
			)
			.subscribe();

		// players: track count and recent joiners
		const playerChannel = supabaseBrowser
			.channel(`set-console-players-${data.gameSet.id}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'players',
					filter: `set_id=eq.${data.gameSet.id}`
				},
				(payload) => {
					livePlayerCount += 1;
					const name = (payload.new as { display_name?: string }).display_name;
					if (name) liveRecentPlayers = [name, ...liveRecentPlayers].slice(0, 5);
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'players',
					filter: `set_id=eq.${data.gameSet.id}`
				},
				(payload) => {
					// Fires when a player's set_id is SET to this set (join via randomizer or UI flow).
					// Players are inserted without set_id, so INSERT filter never matches — this catches joins.
					const p = payload.new as { id?: string; set_id?: string | null; display_name?: string };
					if (p.set_id === data.gameSet.id && p.id && !knownPlayerIds.has(p.id)) {
						knownPlayerIds.add(p.id);
						livePlayerCount += 1;
						if (p.display_name)
							liveRecentPlayers = [p.display_name, ...liveRecentPlayers].slice(0, 5);
					}
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'DELETE',
					schema: 'public',
					table: 'players'
				},
				() => {
					livePlayerCount = Math.max(0, livePlayerCount - 1);
				}
			)
			.subscribe();

		return () => {
			supabaseBrowser.removeChannel(channel);
			supabaseBrowser.removeChannel(playerChannel);
		};
	});

	// ── Challenge picker state ────────────────────────────────────────────────
	let selected = $state<string[]>(data.setChallenges.map((sc) => sc.challenge_id));
	const available = $derived(data.allChallenges.filter((c) => !selected.includes(c.id)));

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

	let dragIdx = $state<number | null>(null);
	function onDragStart(idx: number) {
		dragIdx = idx;
	}
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

	let multipliers = $state<Record<string, number>>(
		Object.fromEntries(
			data.setChallenges.map((sc) => [
				sc.challenge_id,
				(sc as unknown as { challenge_multiplier?: number }).challenge_multiplier ?? 1
			])
		)
	);

	let nfcSlugs = $state<Record<string, string>>(
		Object.fromEntries(
			data.challengeUnlockTags?.map((t: { challenge_id: string; slug: string }) => [
				t.challenge_id,
				t.slug
			]) ?? []
		)
	);

	function addWithMultiplier(id: string) {
		if (!selected.includes(id)) {
			selected = [...selected, id];
			if (!multipliers[id]) multipliers = { ...multipliers, [id]: 1 };
		}
	}

	// ── Toggles ───────────────────────────────────────────────────────────────
	let nfcLockEnabled = $state(data.gameSet.nfc_lock_enabled ?? false);
	let randomizerEnabled = $state(data.gameSet.randomizer_enabled ?? false);

	// ── Randomizer card state ─────────────────────────────────────────────────
	let newSlug = $state('');
	let savingChallenges = $state(false);

	// ── Challenges section expand/collapse ────────────────────────────────────
	let challengesExpanded = $state(true);

	// ── Timer display ─────────────────────────────────────────────────────────
	let timerDisplay = $state('');
	let timerExpired = $state(false);

	onMount(() => {
		if (!gs.total_timer_seconds || !gs.started_at) return;

		const endTime = new Date(gs.started_at).getTime() + gs.total_timer_seconds * 1000;

		const tick = () => {
			if (livePlayState !== 'playing') return;
			const remaining = Math.max(0, endTime - Date.now());
			const m = Math.floor(remaining / 60000);
			const s = Math.floor((remaining % 60000) / 1000);
			timerDisplay = `${m}:${s.toString().padStart(2, '0')}`;

			if (remaining === 0 && !timerExpired) {
				timerExpired = true;
				// Trigger server-side auto-end (same endpoint /admin/live polls)
				fetch('/api/auto-submit', { method: 'POST' }).catch(() => {});
			}
		};

		tick();
		const iv = setInterval(tick, 1000);
		return () => clearInterval(iv);
	});

	// ── Auto-submit polling (Bug 1 fix) ──────────────────────────────────────
	// The timer tick fires once at expiry; this polling is a safety net that also
	// handles the case where the page is opened after the timer has already expired.
	$effect(() => {
		if (livePlayState !== 'playing') return;
		const interval = setInterval(() => {
			fetch('/api/auto-submit', { method: 'POST' }).catch(() => {});
		}, 10_000);
		return () => clearInterval(interval);
	});

	// ── Last results ──────────────────────────────────────────────────────────
	type LastResultEntry = {
		rank: number;
		team_id: string;
		team_name: string;
		score: number;
		photo_url: string | null;
	};
	const lastResults = $derived<LastResultEntry[] | null>(
		Array.isArray(data.gameSet.last_results)
			? (data.gameSet.last_results as unknown as LastResultEntry[])
			: null
	);
	const lastResultsTop3 = $derived(lastResults ? lastResults.slice(0, 3) : []);
	// Podium order: 2nd, 1st, 3rd
	const podiumOrder = $derived(
		[lastResultsTop3[1], lastResultsTop3[0], lastResultsTop3[2]].filter(
			(x): x is LastResultEntry => !!x
		)
	);

	// ── Inline edit (auto-save on blur) ───────────────────────────────────────
	let editName = $state(data.gameSet.name);
	let editDesc = $state(data.gameSet.description ?? '');
	let editTeamCount = $state(data.gameSet.team_count);
	let editExpected = $state<number | ''>(data.gameSet.expected_player_count ?? '');
	let editTimer = $state<number | ''>(
		data.gameSet.total_timer_seconds ? Math.round(data.gameSet.total_timer_seconds / 60) : ''
	);
	let savedFlash = $state(false);
	let flashTimer: ReturnType<typeof setTimeout> | null = null;
	let autoSaveForm: HTMLFormElement | undefined;

	function triggerAutoSave() {
		autoSaveForm?.requestSubmit();
	}

	// ── NFC URL copy ──────────────────────────────────────────────────────────
	let copiedSlug = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	function copyNfcUrl(slug: string) {
		if (!slug) return;
		navigator.clipboard.writeText(`${window.location.origin}/nfc/${slug}`).then(() => {
			copiedSlug = slug;
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => {
				copiedSlug = null;
			}, 1500);
		});
	}
</script>

<svelte:head>
	<title>{gs.name} — Admin Sets</title>
</svelte:head>

<div class="max-w-4xl space-y-6 p-6">
	<!-- ── Header ───────────────────────────────────────────────────────────── -->
	<div>
		<a href="/admin/sets" class="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
			>← Sets</a
		>
		<div class="mt-2 flex items-start justify-between gap-4">
			<div class="min-w-0 flex-1">
				<input
					bind:value={editName}
					onblur={triggerAutoSave}
					aria-label="Set name"
					class="w-full border-b border-transparent bg-transparent text-2xl font-black text-white transition-colors focus:border-amber-500 focus:outline-none"
				/>
				<input
					bind:value={editDesc}
					onblur={triggerAutoSave}
					placeholder="Add a description…"
					aria-label="Set description"
					class="mt-1 w-full border-b border-transparent bg-transparent text-sm text-zinc-500 transition-colors placeholder:text-zinc-700 focus:border-zinc-700 focus:outline-none"
				/>
			</div>
			<div class="mt-1 flex shrink-0 items-center gap-3">
				{#if savedFlash}
					<span class="text-xs font-semibold text-green-400">saved ✓</span>
				{/if}
				<span
					class="rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide uppercase
					{isActive ? 'bg-green-900/60 text-green-400' : 'bg-zinc-700 text-zinc-400'}"
				>
					{gs.status}
				</span>
			</div>
		</div>
	</div>

	{#if form?.error}
		{@const f = form as unknown as {
			existingTagUrl?: string | null;
			existingTagPurpose?: string | null;
		}}
		<div class="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
			{form.error}
			{#if f.existingTagUrl}
				<a href={f.existingTagUrl} class="ml-2 underline hover:text-red-300"
					>View existing {f.existingTagPurpose ?? ''} tag →</a
				>
			{/if}
		</div>
	{/if}
	{#if form?.success}
		<div
			class="rounded-lg border border-green-800 bg-green-950/40 px-4 py-3 text-sm text-green-400"
		>
			Saved.
		</div>
	{/if}

	<!-- Hidden auto-save form (blur-to-save for name, description, and console config fields) -->
	<form
		bind:this={autoSaveForm}
		method="POST"
		action="?/update"
		class="sr-only"
		use:enhance={() =>
			async ({ update }) => {
				await update({ reset: false });
				savedFlash = true;
				if (flashTimer) clearTimeout(flashTimer);
				flashTimer = setTimeout(() => {
					savedFlash = false;
				}, 1500);
			}}
	>
		<input type="hidden" name="name" value={editName} />
		<input type="hidden" name="description" value={editDesc} />
		<input type="hidden" name="team_count" value={editTeamCount} />
		<input type="hidden" name="expected_player_count" value={editExpected} />
		<input type="hidden" name="total_timer_minutes" value={editTimer} />
	</form>

	<!-- ── Gameset Console ───────────────────────────────────────────────────── -->
	<section class="rounded-xl border border-zinc-800 bg-zinc-900">
		<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
			<h2 class="text-sm font-bold tracking-widest text-zinc-400 uppercase">Gameset Console</h2>
			{#if isActive}
				<form
					method="POST"
					action="?/toggle"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
				>
					<button
						type="submit"
						class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
					>
						Deactivate set
					</button>
				</form>
			{/if}
		</div>

		<!-- Config row: editable fields that blur-to-save -->
		<div class="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800">
			<div class="px-5 py-3">
				<div class="mb-1 text-xs tracking-wide text-zinc-600 uppercase">Teams</div>
				<input
					type="number"
					min="2"
					max="6"
					bind:value={editTeamCount}
					onblur={triggerAutoSave}
					class="w-full bg-transparent text-xl font-black text-white focus:outline-none"
				/>
			</div>
			<div class="px-5 py-3">
				<div class="mb-1 text-xs tracking-wide text-zinc-600 uppercase">Expected players</div>
				<input
					type="number"
					min="1"
					bind:value={editExpected}
					onblur={triggerAutoSave}
					placeholder="—"
					class="w-full bg-transparent text-xl font-black text-white placeholder:text-zinc-700 focus:outline-none"
				/>
			</div>
			<div class="px-5 py-3">
				<div class="mb-1 text-xs tracking-wide text-zinc-600 uppercase">Timer (min)</div>
				<input
					type="number"
					min="1"
					bind:value={editTimer}
					onblur={triggerAutoSave}
					placeholder="—"
					class="w-full bg-transparent text-xl font-black text-white placeholder:text-zinc-700 focus:outline-none"
				/>
			</div>
		</div>

		<div class="p-5">
			{#if !isActive}
				<!-- Inactive: only activate button -->
				<p class="mb-4 text-sm text-zinc-500">
					Set is inactive. Activate it to allow players to join.
				</p>
				<form
					method="POST"
					action="?/toggle"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
					onsubmit={(e) => {
						const count = gs.expected_player_count;
						if (count && count > 0 && count % gs.team_count !== 0) {
							const base = Math.floor(count / gs.team_count);
							const extra = count % gs.team_count;
							const msg = `Uneven distribution — ${extra} team${extra > 1 ? 's' : ''} will have ${base + 1} players and ${gs.team_count - extra} will have ${base}. Continue?`;
							if (!confirm(msg)) e.preventDefault();
						}
					}}
				>
					<button
						type="submit"
						class="w-full rounded-xl bg-green-700 py-3 text-sm font-bold text-white transition-colors hover:bg-green-600"
					>
						Activate set
					</button>
				</form>
			{:else if livePlayState === 'joining'}
				<!-- Joining state -->
				<div class="mb-5 grid grid-cols-2 gap-4">
					<div class="rounded-lg bg-zinc-800/60 px-4 py-3 text-center">
						<div class="text-2xl font-black text-white">{livePlayerCount}</div>
						<div class="mt-0.5 text-xs text-zinc-500">players joined</div>
					</div>
					<a
						href="/admin/sets/{gs.id}/lobby"
						class="flex items-center justify-center rounded-lg border border-zinc-700 px-4 py-3 text-sm font-semibold text-amber-400 transition-colors hover:border-zinc-600"
					>
						View lobby →
					</a>
				</div>

				{#if liveRecentPlayers.length > 0}
					<div class="mb-4">
						<div class="mb-2 text-xs font-semibold tracking-wide text-zinc-600 uppercase">
							Recently joined
						</div>
						<div class="flex flex-wrap gap-1.5">
							{#each liveRecentPlayers as name}
								<span class="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300"
									>{name}</span
								>
							{/each}
						</div>
					</div>
				{/if}

				{#if livePlayerCount > 0}
					<form method="POST" action="?/startGame" use:enhance>
						<button
							type="submit"
							class="w-full rounded-xl bg-green-600 py-4 text-base font-bold text-white transition-colors hover:bg-green-500"
						>
							Start the game →
						</button>
					</form>
				{:else}
					<p class="py-2 text-center text-sm text-zinc-600">
						Waiting for at least one player to join…
					</p>
				{/if}
			{:else if livePlayState === 'playing'}
				<!-- Playing state -->
				{#if timerDisplay}
					<div class="mb-4 text-center">
						{#if timerExpired}
							<div class="font-mono text-2xl font-black text-red-400">Time's up!</div>
							<div class="mt-0.5 text-xs text-zinc-500">Ending game…</div>
						{:else}
							<div class="font-mono text-4xl font-black text-amber-400">{timerDisplay}</div>
							<div class="mt-0.5 text-xs text-zinc-600">remaining</div>
						{/if}
					</div>
				{/if}

				{#if liveTeamProgress.length > 0}
					<div class="mb-5 space-y-2">
						{#each liveTeamProgress as t}
							<div class="flex items-center justify-between text-sm">
								<span class="text-zinc-300">{t.name}</span>
								<span class="font-mono text-zinc-500">{t.done}/{t.total}</span>
							</div>
						{/each}
					</div>
				{/if}

				<form
					method="POST"
					action="?/startRecap"
					use:enhance
					onsubmit={(e) => {
						if (!confirm('End the game now? Players will move to the recap stage.'))
							e.preventDefault();
					}}
				>
					<button
						type="submit"
						disabled={timerExpired}
						class="w-full rounded-xl bg-red-700 py-3 text-sm font-bold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
					>
						End game
					</button>
				</form>
			{:else if livePlayState === 'recap'}
				<!-- Recap state -->
				<div class="space-y-3">
					{#if liveRecapState !== 'complete'}
						<a
							href="/admin/sets/{gs.id}/recap"
							class="block w-full rounded-xl bg-amber-400 py-3 text-center text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
						>
							{liveRecapState === 'pending' ? 'Start recap →' : 'View recap →'}
						</a>
					{:else}
						<div
							class="rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-center text-sm text-zinc-400"
						>
							Recap complete
						</div>
						<a
							href="/admin/sets/{gs.id}/recap"
							class="block text-center text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
						>
							View recap →
						</a>
					{/if}

					<form
						method="POST"
						action="?/resetGame"
						use:enhance
						onsubmit={(e) => {
							if (
								!confirm(
									'Reset this game? Player sessions, scores, and submissions will be cleared. Last results will be preserved.'
								)
							)
								e.preventDefault();
						}}
					>
						<button
							type="submit"
							class="w-full rounded-xl border border-red-800/60 py-2.5 text-sm font-semibold text-red-400 transition-colors hover:border-red-700 hover:text-red-300"
						>
							Reset game
						</button>
						<p class="mt-1.5 text-center text-xs text-zinc-600">
							Clears scores, submissions, and player sessions for this set. Last results are
							preserved.
						</p>
					</form>
				</div>
			{/if}
		</div>

		<!-- Randomizer card toggle (bottom of console) -->
		{#if isActive}
			<div class="border-t border-zinc-800 px-5 py-4">
				<div class="mb-3 flex items-center justify-between">
					<span class="text-sm font-semibold text-zinc-300">Randomizer card</span>
					<form
						method="POST"
						action="?/toggleRandomizer"
						use:enhance={() =>
							async ({ update }) =>
								update({ reset: false })}
					>
						<button
							type="submit"
							class="rounded-full px-3 py-1 text-xs font-semibold transition-colors
								{randomizerEnabled
								? 'bg-green-800/60 text-green-400 hover:bg-green-800'
								: 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}"
						>
							{randomizerEnabled ? 'ON' : 'OFF'}
						</button>
					</form>
				</div>

				{#if randomizerEnabled}
					{#if data.cards.length > 0}
						<div class="space-y-2">
							{#each data.cards as card}
								<div
									class="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2"
								>
									<span class="font-mono text-sm text-zinc-300">{card.slug}</span>
									<div class="flex items-center gap-2">
										<button
											type="button"
											onclick={() => copyNfcUrl(card.slug)}
											class="rounded px-2 py-0.5 text-xs font-semibold transition-colors
												{copiedSlug === card.slug ? 'text-green-400' : 'text-zinc-500 hover:text-zinc-300'}"
										>
											{copiedSlug === card.slug ? 'Copied ✓' : 'Copy'}
										</button>
										<form method="POST" action="?/removeCard" use:enhance>
											<input type="hidden" name="slug" value={card.slug} />
											<button
												type="submit"
												class="rounded px-2 py-0.5 text-xs font-semibold text-zinc-500 transition-colors hover:bg-red-900/40 hover:text-red-400"
											>
												Remove
											</button>
										</form>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<form
							method="POST"
							action="?/addCard"
							use:enhance={({ formData: _fd }) =>
								async ({ result, update }) => {
									if (result.type !== 'failure') newSlug = '';
									await update();
								}}
							class="flex gap-2"
						>
							<input
								name="slug"
								bind:value={newSlug}
								class="admin-input flex-1"
								placeholder="NFC tag slug, e.g. random-stage-1"
								required
							/>
							<button
								type="button"
								disabled={!newSlug}
								onclick={() => copyNfcUrl(newSlug)}
								class="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold transition-colors
									{copiedSlug === newSlug && newSlug
									? 'border-green-800 text-green-400'
									: 'text-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-30'}"
							>
								{copiedSlug === newSlug && newSlug ? 'Copied ✓' : 'Copy'}
							</button>
							<button
								type="submit"
								class="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-600"
							>
								Add
							</button>
						</form>
					{/if}
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── Last results panel ────────────────────────────────────────────────── -->
	{#if lastResults && lastResults.length > 0}
		<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
			<h2 class="mb-4 text-sm font-bold tracking-widest text-zinc-400 uppercase">
				Last played results
			</h2>

			<!-- Top 3 podium (podiumOrder derived in script: 2nd, 1st, 3rd) -->
			<div class="mb-5 flex items-end justify-center gap-3">
				{#each podiumOrder as t, podiumIdx}
					{@const isFst = t.rank === 1}
					<div
						class="flex flex-col items-center gap-1.5 text-center
						{isFst ? 'order-2' : podiumIdx === 0 ? 'order-1' : 'order-3'}"
					>
						<div class="text-xs font-bold text-zinc-500">#{t.rank}</div>
						<div class="font-black text-white {isFst ? 'text-lg' : 'text-base'}">{t.team_name}</div>
						<div class="text-sm font-bold text-amber-400">{t.score} pts</div>
					</div>
				{/each}
			</div>

			<!-- Full list (4th+ if any) -->
			{#if lastResults && lastResults.length > 3}
				<div class="space-y-1 border-t border-zinc-800 pt-3">
					{#each lastResults.slice(3) as t}
						<div class="flex items-center justify-between text-sm">
							<span class="text-zinc-500">#{t.rank}</span>
							<span class="text-zinc-300">{t.team_name}</span>
							<span class="font-mono text-zinc-400">{t.score} pts</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	<!-- ── Challenge configuration (collapsible) ─────────────────────────────── -->
	<section class="rounded-xl border border-zinc-800 bg-zinc-900">
		<button
			type="button"
			onclick={() => (challengesExpanded = !challengesExpanded)}
			class="flex w-full items-center justify-between border-b border-zinc-800 px-5 py-4 text-left"
		>
			<h2 class="text-sm font-bold tracking-widest text-zinc-400 uppercase">
				Challenges in this set
				{#if selected.length > 0}
					<span class="ml-2 font-normal text-zinc-600 normal-case">({selected.length})</span>
				{/if}
			</h2>
			<span class="text-sm text-zinc-600">{challengesExpanded ? '▲' : '▼'}</span>
		</button>

		<!-- NFC lock toggle: always visible, independent of collapsible state and set status -->
		<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
			<div>
				<span class="text-sm font-semibold text-zinc-300">NFC unlock required</span>
				<p class="mt-0.5 text-xs text-zinc-600">
					When enabled, each challenge requires the team to scan its NFC tag before playing.
				</p>
			</div>
			<form
				method="POST"
				action="?/toggleNfcLock"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
			>
				<button
					type="submit"
					class="rounded-full px-3 py-1 text-xs font-semibold transition-colors
						{nfcLockEnabled
						? 'bg-green-800/60 text-green-400 hover:bg-green-800'
						: 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}"
				>
					{nfcLockEnabled ? 'ON' : 'OFF'}
				</button>
			</form>
		</div>

		{#if challengesExpanded}
			<div class="p-5">
				{#if isActive}
					<p class="mb-3 text-xs text-amber-400">
						Set is active — changes take effect immediately.
					</p>
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
					<input type="hidden" name="challenge_ids" value={selected.join(',')} />
					<input type="hidden" name="multipliers_json" value={JSON.stringify(multipliers)} />
					<input type="hidden" name="nfc_slugs_json" value={JSON.stringify(nfcSlugs)} />

					{#if selected.length > 0}
						<div class="mb-4 space-y-1">
							{#each selected as id, idx}
								<div
									draggable="true"
									role="listitem"
									ondragstart={() => onDragStart(idx)}
									ondragover={(e) => e.preventDefault()}
									ondrop={() => onDrop(idx)}
									class="cursor-grab rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 active:cursor-grabbing"
								>
									<div class="flex items-center gap-2">
										<span class="text-zinc-600 select-none">⠿</span>
										<div class="min-w-0 flex-1">
											<a
												href="/admin/challenges/{id}"
												class="block truncate text-sm font-medium text-white transition-colors hover:text-amber-400"
											>
												{challengeTitle(id)}
											</a>
											<div class="text-xs text-zinc-500">{challengeVariant(id)}</div>
										</div>
										<!-- Multiplier -->
										<div class="flex shrink-0 items-center gap-1">
											<span class="text-xs text-zinc-500">×</span>
											<select
												class="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-200 focus:outline-none"
												value={multipliers[id] ?? 1}
												onchange={(e) => {
													multipliers = {
														...multipliers,
														[id]: parseInt((e.target as HTMLSelectElement).value)
													};
												}}
											>
												{#each [1, 2, 3, 4, 5] as m}<option value={m}>{m}×</option>{/each}
											</select>
										</div>
										<div class="flex shrink-0 gap-1">
											<button
												type="button"
												onclick={() => moveUp(idx)}
												disabled={idx === 0}
												class="rounded p-1 text-zinc-500 hover:text-white disabled:opacity-20"
												>↑</button
											>
											<button
												type="button"
												onclick={() => moveDown(idx)}
												disabled={idx >= selected.length - 1}
												class="rounded p-1 text-zinc-500 hover:text-white disabled:opacity-20"
												>↓</button
											>
											<button
												type="button"
												onclick={() => remove(id)}
												class="rounded p-1 text-zinc-500 hover:text-red-400">×</button
											>
										</div>
									</div>
									<!-- NFC lock slot (shown when nfc_lock_enabled) -->
									{#if nfcLockEnabled}
										<div class="mt-2 flex items-center gap-2 pl-6">
											<span class="text-xs text-zinc-600">🔒 NFC slug:</span>
											<input
												type="text"
												placeholder="e.g. unlock-room-1"
												value={nfcSlugs[id] ?? ''}
												oninput={(e) => {
													nfcSlugs = { ...nfcSlugs, [id]: (e.target as HTMLInputElement).value };
												}}
												class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
											/>
											<button
												type="button"
												disabled={!nfcSlugs[id]}
												onclick={() => copyNfcUrl(nfcSlugs[id] ?? '')}
												class="shrink-0 rounded px-2 py-0.5 text-xs font-semibold transition-colors
													{copiedSlug === nfcSlugs[id] && nfcSlugs[id]
													? 'text-green-400'
													: 'text-zinc-500 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-30'}"
											>
												{copiedSlug === nfcSlugs[id] && nfcSlugs[id] ? 'Copied ✓' : 'Copy'}
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="mb-4 text-sm text-zinc-600">No challenges added yet.</p>
					{/if}

					<!-- Available challenges picker -->
					{#if available.length > 0}
						<div
							class="mb-4 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800/50"
						>
							{#each available as c}
								<button
									type="button"
									onclick={() => addWithMultiplier(c.id)}
									class="flex w-full items-center gap-3 border-b border-zinc-700/50 px-3 py-2 text-left transition-colors last:border-0 hover:bg-zinc-700/50"
								>
									<span class="text-sm text-amber-400">+</span>
									<div>
										<div class="text-sm text-white">{c.title}</div>
										<div class="text-xs text-zinc-500">
											{c.variant}{c.is_active ? '' : ' · inactive'}
										</div>
									</div>
								</button>
							{/each}
						</div>
					{/if}

					<button
						type="submit"
						disabled={savingChallenges}
						class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-300 disabled:opacity-50"
					>
						{savingChallenges ? 'Saving…' : 'Save Challenge Order'}
					</button>
				</form>
			</div>
		{/if}
	</section>

	<!-- ── Danger zone (delete, inactive only) ──────────────────────────────── -->
	{#if !isActive}
		<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
			<h2 class="mb-4 text-sm font-bold tracking-widest text-zinc-400 uppercase">Danger zone</h2>
			<form
				method="POST"
				action="?/delete"
				use:enhance
				onsubmit={(e) => {
					if (!confirm(`Delete "${gs.name}"? This cannot be undone.`)) e.preventDefault();
				}}
			>
				<button
					type="submit"
					class="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:border-red-800 hover:text-red-400"
				>
					Delete set
				</button>
			</form>
		</section>
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
