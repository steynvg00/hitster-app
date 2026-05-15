<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData, ActionData } from './$types';
	import type {
		PowerupMode,
		PowerupVisibility,
		ThresholdConfig,
		TokenShopConfig
	} from '$lib/types';
	import { getVariantIcon, getVariantColor } from '$lib/variants';
	import HelpTooltip from '$lib/components/ui/HelpTooltip.svelte';
	import { ChevronDown, ChevronRight } from 'lucide-svelte';

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
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
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
	function challengeNfcOverride(id: string): boolean | null {
		const ch = data.allChallenges.find((c) => c.id === id);
		return (ch as unknown as { nfc_lock_override?: boolean | null })?.nfc_lock_override ?? null;
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

	// ── NFC slug blur-to-save ─────────────────────────────────────────────────
	let challengesForm: HTMLFormElement | undefined;
	let slugSavingId = $state<string | null>(null);
	let slugSavedId = $state<string | null>(null);

	function onSlugBlur(challengeId: string) {
		slugSavingId = challengeId;
		challengesForm?.requestSubmit();
	}

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

	// ── Powerups section ─────────────────────────────────────────────────────
	let powerupsEnabled = $state(data.gameSet.powerups_enabled ?? false);
	let powerupMode = $state<PowerupMode>(data.powerupMode);
	let savingPowerupConfig = $state(false);

	// Threshold config state
	const initThresholds = () =>
		(data.powerupSetConfig as ThresholdConfig).thresholds_percent?.map((v) => v) ?? [25, 50, 75];
	let thresholds = $state<number[]>(
		data.powerupMode === 'threshold' ? initThresholds() : [25, 50, 75]
	);

	// Token shop config state
	const initShop = () => data.powerupSetConfig as TokenShopConfig;
	let earningStarting = $state(data.powerupMode === 'token_shop' ? initShop().starting_tokens : 0);
	let earningPerCorrect = $state(
		data.powerupMode === 'token_shop' ? initShop().per_correct_challenge : 1
	);
	let earningStreaks = $state<Array<{ streak: number; bonus: number }>>(
		data.powerupMode === 'token_shop'
			? initShop().streak_bonuses.map((s) => ({ ...s }))
			: [
					{ streak: 3, bonus: 2 },
					{ streak: 5, bonus: 5 }
				]
	);
	let earningTimeTick = $state<number | ''>(
		data.powerupMode === 'token_shop' ? (initShop().time_tick_minutes ?? '') : ''
	);
	let earningTokensPerTick = $state(
		data.powerupMode === 'token_shop' ? initShop().tokens_per_tick : 1
	);

	const VISIBILITY_OPTIONS: PowerupVisibility[] = ['public', 'target_only', 'hidden', 'silent'];

	const CATEGORY_ORDER = ['offensive', 'defensive', 'information', 'social', 'self'] as const;

	// Collapsed state per category — persisted in localStorage
	const COLLAPSE_KEY = 'hitster_powerup_categories_collapsed';
	function loadCollapsed(): Record<string, boolean> {
		if (typeof localStorage === 'undefined') return {};
		try {
			return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
		} catch {
			return {};
		}
	}
	let collapsedCategories = $state<Record<string, boolean>>(loadCollapsed());

	onMount(() => {
		collapsedCategories = loadCollapsed();
	});

	function toggleCategory(cat: string) {
		collapsedCategories = { ...collapsedCategories, [cat]: !collapsedCategories[cat] };
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedCategories));
		}
	}

	// Powerups grouped by category
	const powerupsByCategory = $derived(
		CATEGORY_ORDER.map((cat) => ({
			category: cat,
			powerups: data.powerupConfigs.filter((p) => p.category === cat)
		}))
	);

	// Category master toggle state: 'on' | 'partial' | 'off'
	function categoryToggleState(cat: string): 'on' | 'partial' | 'off' {
		const items = data.powerupConfigs.filter((p) => p.category === cat);
		if (items.length === 0) return 'off';
		const enabledCount = items.filter((p) => p.effective_enabled).length;
		if (enabledCount === items.length) return 'on';
		if (enabledCount === 0) return 'off';
		return 'partial';
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
				<form method="POST" action="?/duplicateSet" use:enhance>
					<button
						type="submit"
						class="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
						title="Duplicate this set"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path
								d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
							/></svg
						>
						Duplicate
					</button>
				</form>
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
				<div class="mb-1 flex items-center text-xs tracking-wide text-zinc-600 uppercase">
					Teams
					<HelpTooltip text="Number of teams in this set (2–6)." />
				</div>
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
				<div class="mb-1 flex items-center text-xs tracking-wide text-zinc-600 uppercase">
					Timer (min)
					<HelpTooltip
						text="Total game length in minutes. The game auto-ends when elapsed, or when the host triggers recap manually."
					/>
				</div>
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
					<span class="flex items-center text-sm font-semibold text-zinc-300">
						Randomizer card
						<HelpTooltip
							text="Enables the team randomization NFC card flow for this set. Teams scan the card to be auto-assigned to a team."
						/>
					</span>
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
				<span class="flex items-center text-sm font-semibold text-zinc-300">
					NFC unlock required
					<HelpTooltip
						text="When on, teams must scan a challenge's NFC unlock card before they can play it. Individual challenges can override this via their own settings."
					/>
				</span>
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
					bind:this={challengesForm}
					method="POST"
					action="?/setChallenges"
					use:enhance={({ formData }) => {
						// Explicitly sync reactive state into formData before the request fires.
						// This bypasses any Svelte 5 scheduler timing between state mutation and DOM
						// flush, and also prevents form.reset() from ever sending stale defaultValues.
						formData.set('challenge_ids', selected.join(','));
						formData.set('multipliers_json', JSON.stringify(multipliers));
						formData.set('nfc_slugs_json', JSON.stringify(nfcSlugs));
						savingChallenges = true;
						const blurredId = slugSavingId;
						slugSavingId = null;
						return async ({ result, update }) => {
							savingChallenges = false;
							await update({ reset: false });
							if (blurredId && result.type !== 'failure') {
								slugSavedId = blurredId;
								setTimeout(() => {
									slugSavedId = null;
								}, 2000);
							}
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
										<div
											class="flex h-6 w-6 shrink-0 items-center justify-center rounded {getVariantColor(
												challengeVariant(id)
											)}"
										>
											<svelte:component this={getVariantIcon(challengeVariant(id))} size={12} />
										</div>
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
									<!-- NFC lock slot (shown when set lock is on, or this challenge always requires unlock) -->
									{#if nfcLockEnabled || challengeNfcOverride(id) === true}
										<div class="mt-2 flex items-center gap-2 pl-6">
											<span class="text-xs text-zinc-600">🔒 NFC slug:</span>
											<input
												type="text"
												placeholder="e.g. unlock-room-1"
												value={nfcSlugs[id] ?? ''}
												oninput={(e) => {
													nfcSlugs = { ...nfcSlugs, [id]: (e.target as HTMLInputElement).value };
												}}
												onblur={() => onSlugBlur(id)}
												class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
											/>
											{#if slugSavedId === id}
												<span class="shrink-0 text-xs font-semibold text-green-400">saved ✓</span>
											{:else}
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
											{/if}
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
									<div
										class="flex h-6 w-6 shrink-0 items-center justify-center rounded {getVariantColor(
											c.variant
										)}"
									>
										<svelte:component this={getVariantIcon(c.variant)} size={12} />
									</div>
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

	<!-- ── Powerups ─────────────────────────────────────────────────────────── -->
	<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<!-- Header with master toggle -->
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-sm font-bold tracking-widest text-zinc-400 uppercase">Powerups</h2>
				<p class="mt-0.5 text-xs text-zinc-600">
					Configure powerup availability and earning mode for this set
				</p>
			</div>
			<form
				method="POST"
				action="?/toggle_powerups_enabled"
				use:enhance={() => {
					powerupsEnabled = !powerupsEnabled;
					return async ({ update }) => {
						await update({ reset: false });
					};
				}}
			>
				<button
					type="submit"
					class="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors
						{powerupsEnabled
						? 'border-amber-500 bg-amber-500/10 text-amber-400'
						: 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'}"
				>
					<span class="h-2 w-2 rounded-full {powerupsEnabled ? 'bg-amber-400' : 'bg-zinc-600'}"
					></span>
					{powerupsEnabled ? 'Enabled' : 'Disabled'}
				</button>
			</form>
		</div>

		{#if powerupsEnabled}
			<!-- Mode selector -->
			<div class="mt-4 mb-1 flex items-center gap-1">
				<span class="text-xs text-zinc-500">Mode</span>
				<HelpTooltip
					text="Score Thresholds awards random powerups when a team's score crosses set percentages. Token Shop lets teams earn and spend tokens on powerups."
				/>
			</div>
			<div class="flex gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 p-1">
				{#each ['threshold', 'token_shop'] as mode (mode)}
					<form
						method="POST"
						action="?/set_powerup_mode"
						class="flex-1"
						use:enhance={() => {
							powerupMode = mode as PowerupMode;
							return async ({ update }) => {
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="mode" value={mode} />
						<button
							type="submit"
							class="w-full rounded px-3 py-1.5 text-xs font-semibold transition-colors
								{powerupMode === mode ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}"
						>
							{mode === 'threshold' ? 'Score Thresholds' : 'Token Shop'}
						</button>
					</form>
				{/each}
			</div>

			<!-- Conditional rules form -->
			<div class="mt-4 rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
				{#if powerupMode === 'threshold'}
					<div class="mb-1 flex items-center gap-1">
						<h3 class="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
							Score Thresholds
						</h3>
						<HelpTooltip
							text="Percentage thresholds of total possible points across played challenges. When a team crosses a threshold, they're awarded a random powerup."
						/>
					</div>
					<p class="mb-3 text-xs text-zinc-600">
						Teams earn a random powerup when their score-percentage crosses each threshold. % =
						team_score / total possible across played challenges.
					</p>
					<form
						method="POST"
						action="?/save_powerup_config"
						use:enhance={() => {
							savingPowerupConfig = true;
							return async ({ update }) => {
								savingPowerupConfig = false;
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="mode" value="threshold" />
						{#each thresholds as _pct, i (i)}
							<div class="mb-1.5 flex items-center gap-2">
								<input
									type="number"
									name="threshold_{i}"
									min="1"
									max="100"
									bind:value={thresholds[i]}
									class="admin-input w-20 py-1 text-xs"
								/>
								<span class="text-xs text-zinc-500">%</span>
								<button
									type="button"
									onclick={() => (thresholds = thresholds.filter((_, j) => j !== i))}
									class="text-xs text-zinc-600 hover:text-red-400"
									title="Remove">✕</button
								>
							</div>
						{/each}
						<button
							type="button"
							onclick={() => (thresholds = [...thresholds, 90])}
							class="mb-3 text-xs text-amber-400 hover:text-amber-300"
						>
							+ Add threshold
						</button>
						<div>
							<button
								type="submit"
								disabled={savingPowerupConfig}
								class="rounded-lg bg-amber-400 px-4 py-1.5 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
							>
								{savingPowerupConfig ? 'Saving…' : 'Save thresholds'}
							</button>
						</div>
					</form>
				{:else}
					<h3 class="mb-3 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
						Token Earning Rules
					</h3>
					<form
						method="POST"
						action="?/save_powerup_config"
						use:enhance={() => {
							savingPowerupConfig = true;
							return async ({ update }) => {
								savingPowerupConfig = false;
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="mode" value="token_shop" />
						<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
							<div>
								<label class="admin-label">Starting tokens</label>
								<input
									type="number"
									name="starting_tokens"
									min="0"
									bind:value={earningStarting}
									class="admin-input"
								/>
							</div>
							<div>
								<label class="admin-label flex items-center">
									Per correct challenge
									<HelpTooltip
										text="Tokens awarded to a team for each correct challenge submission."
									/>
								</label>
								<input
									type="number"
									name="per_correct_challenge"
									min="0"
									bind:value={earningPerCorrect}
									class="admin-input"
								/>
							</div>
							<div>
								<label class="admin-label">Time tick (min)</label>
								<input
									type="number"
									name="time_tick_minutes"
									min="1"
									placeholder="Off"
									bind:value={earningTimeTick}
									class="admin-input"
								/>
							</div>
							<div>
								<label class="admin-label">Tokens per tick</label>
								<input
									type="number"
									name="tokens_per_tick"
									min="1"
									bind:value={earningTokensPerTick}
									class="admin-input"
								/>
							</div>
						</div>
						<div class="mt-3">
							<div class="mb-1 flex items-center justify-between">
								<span class="admin-label" style="margin-bottom:0">Streak bonuses</span>
								<button
									type="button"
									onclick={() => (earningStreaks = [...earningStreaks, { streak: 3, bonus: 2 }])}
									class="text-xs text-amber-400 hover:text-amber-300"
								>
									+ Add row
								</button>
							</div>
							{#if earningStreaks.length === 0}
								<p class="text-xs text-zinc-600">No streak bonuses configured.</p>
							{/if}
							{#each earningStreaks as row, i (i)}
								<div class="mb-1.5 flex items-center gap-2">
									<span class="shrink-0 text-xs text-zinc-500">Streak ≥</span>
									<input
										type="number"
										name="streak_streak_{i}"
										min="1"
										bind:value={row.streak}
										class="admin-input w-16 py-1 text-xs"
									/>
									<span class="shrink-0 text-xs text-zinc-500">→ bonus</span>
									<input
										type="number"
										name="streak_bonus_{i}"
										min="0"
										bind:value={row.bonus}
										class="admin-input w-16 py-1 text-xs"
									/>
									<button
										type="button"
										onclick={() => (earningStreaks = earningStreaks.filter((_, j) => j !== i))}
										class="text-xs text-zinc-600 hover:text-red-400"
										title="Remove">✕</button
									>
								</div>
							{/each}
						</div>
						<button
							type="submit"
							disabled={savingPowerupConfig}
							class="mt-3 rounded-lg bg-amber-400 px-4 py-1.5 text-xs font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
						>
							{savingPowerupConfig ? 'Saving…' : 'Save earning rules'}
						</button>
					</form>
				{/if}
			</div>

			<!-- Powerup grid — grouped by category -->
			<div class="mt-4 space-y-3">
				<h3 class="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
					Powerup Config
				</h3>
				{#each powerupsByCategory as { category, powerups: catPowerups }}
					{@const toggleState = categoryToggleState(category)}
					{@const collapsed = !!collapsedCategories[category]}
					<div class="rounded-lg border border-zinc-800">
						<!-- Category header -->
						<div class="flex items-center gap-2 px-3 py-2">
							<button
								type="button"
								onclick={() => toggleCategory(category)}
								class="flex flex-1 items-center gap-2 text-left"
							>
								{#if collapsed}
									<ChevronRight size={14} class="shrink-0 text-zinc-500" />
								{:else}
									<ChevronDown size={14} class="shrink-0 text-zinc-500" />
								{/if}
								<span class="text-sm font-semibold text-zinc-300 capitalize">{category}</span>
								<span class="text-xs text-zinc-600">
									{catPowerups.filter((p) => p.effective_enabled).length}/{catPowerups.length} enabled
								</span>
							</button>
							<!-- Master toggle (tri-state) -->
							{#if catPowerups.length > 0}
								<form
									method="POST"
									action="?/togglePowerupCategory"
									use:enhance={() =>
										async ({ update }) =>
											update({ reset: false })}
								>
									<input type="hidden" name="category" value={category} />
									<input
										type="hidden"
										name="enabled"
										value={toggleState === 'off' ? 'true' : 'false'}
									/>
									<button
										type="submit"
										title={toggleState === 'off' ? 'Enable all' : 'Disable all'}
										class="flex h-6 w-10 shrink-0 items-center rounded-full border px-0.5 transition-colors
											{toggleState === 'on'
											? 'border-green-700 bg-green-900/60'
											: toggleState === 'partial'
												? 'border-amber-700 bg-amber-900/40'
												: 'border-zinc-700 bg-zinc-800'}"
									>
										<span
											class="h-4 w-4 rounded-full transition-all
												{toggleState === 'on'
												? 'translate-x-4 bg-green-400'
												: toggleState === 'partial'
													? 'translate-x-2 bg-amber-400'
													: 'translate-x-0 bg-zinc-600'}"
										></span>
									</button>
								</form>
							{/if}
						</div>

						<!-- Powerup rows (collapsible body) -->
						{#if !collapsed}
							{#if catPowerups.length === 0}
								<div class="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-600">
									No {category} powerups yet.
								</div>
							{:else}
								<div class="border-t border-zinc-800">
									{#each catPowerups as p (p.id)}
										<div
											class="flex flex-wrap items-center gap-3 border-b border-zinc-800/60 px-4 py-3 last:border-0
												{p.effective_enabled ? '' : 'opacity-50'}"
										>
											<!-- Name -->
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="text-sm font-semibold text-zinc-200">{p.name}</span>
													{#if p.has_override}
														<span class="text-xs text-amber-400">edited</span>
													{/if}
												</div>
												<p class="mt-0.5 text-xs text-zinc-500">{p.description}</p>
											</div>

											<!-- Enabled toggle -->
											<form
												method="POST"
												action="?/update_powerup_config"
												use:enhance={() =>
													async ({ update }) =>
														update({ reset: false })}
											>
												<input type="hidden" name="powerup_id" value={p.id} />
												<input type="hidden" name="field" value="enabled" />
												<input type="hidden" name="value" value={String(!p.effective_enabled)} />
												<button
													type="submit"
													class="flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition-colors
														{p.effective_enabled
														? 'border-green-800 bg-green-950/40 text-green-400 hover:border-green-700'
														: 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'}"
												>
													{p.effective_enabled ? 'On' : 'Off'}
												</button>
											</form>

											<!-- Cost (token shop only) -->
											{#if powerupMode === 'token_shop'}
												<form
													method="POST"
													action="?/update_powerup_config"
													use:enhance={() =>
														async ({ update }) =>
															update({ reset: false })}
												>
													<input type="hidden" name="powerup_id" value={p.id} />
													<input type="hidden" name="field" value="cost_override" />
													<label class="flex items-center gap-1.5">
														<span class="text-xs text-zinc-500">Cost</span>
														<input
															type="number"
															name="value"
															min="1"
															value={p.effective_cost}
															onblur={(e) => {
																const f = (e.target as HTMLInputElement).closest(
																	'form'
																) as HTMLFormElement | null;
																f?.requestSubmit();
															}}
															class="admin-input w-16 py-0.5 text-xs"
														/>
													</label>
												</form>
											{:else}
												<span
													class="text-xs text-zinc-600"
													title="Cost unused in Score Thresholds mode">Cost —</span
												>
											{/if}

											<!-- Visibility override -->
											<form
												method="POST"
												action="?/update_powerup_config"
												use:enhance={() =>
													async ({ update }) =>
														update({ reset: false })}
											>
												<input type="hidden" name="powerup_id" value={p.id} />
												<input type="hidden" name="field" value="visibility_override" />
												<label class="flex items-center gap-1.5">
													<span class="text-xs text-zinc-500">Visibility</span>
													<select
														name="value"
														value={p.effective_visibility}
														onchange={(e) => {
															const f = (e.target as HTMLSelectElement).closest(
																'form'
															) as HTMLFormElement | null;
															f?.requestSubmit();
														}}
														class="admin-input py-0.5 text-xs"
													>
														{#each VISIBILITY_OPTIONS as v}
															<option value={v}>{v}</option>
														{/each}
													</select>
												</label>
											</form>
										</div>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				{/each}
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
