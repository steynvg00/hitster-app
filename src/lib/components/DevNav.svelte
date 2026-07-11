<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { fly } from 'svelte/transition';
	import { Terminal, X, ChevronDown, ChevronRight, Copy, Check, RefreshCw } from 'lucide-svelte';

	// ── Types ──────────────────────────────────────────────────────────────────

	type DevState = {
		user: { id: string; email: string | null } | null;
		team_cookie: string | null;
		active_set: { id: string; name: string; play_state: string } | null;
		recent_sets: Array<{ id: string; name: string; status: string; created_at: string }>;
		recent_challenges: Array<{ id: string; name: string; variant: string; status: string }>;
	};

	type LinkDef = {
		label: string;
		path?: string;
		setPath?: (id: string) => string;
		challengePath?: (id: string) => string;
	};

	type Section = {
		id: string;
		title: string;
		links: LinkDef[];
		isApi?: boolean;
	};

	// ── State ──────────────────────────────────────────────────────────────────

	let open = $state(false);
	let search = $state('');
	let devState = $state<DevState | null>(null);
	let loading = $state(false);
	let setIdOverride = $state('');
	let challengeId = $state('');
	let collapsed = $state<Record<string, boolean>>({});
	let copied = $state<string | null>(null);
	let focusedIndex = $state(-1);
	let searchInput: HTMLInputElement | undefined;

	// ── Derived ────────────────────────────────────────────────────────────────

	const activeSetId = $derived(devState?.active_set?.id ?? setIdOverride);
	const activeChallengeId = $derived(challengeId || devState?.recent_challenges?.[0]?.id || '');

	// ── Route definitions ──────────────────────────────────────────────────────

	const SECTIONS: Section[] = [
		{
			id: 'public',
			title: 'Public',
			links: [
				{ label: '/ Home', path: '/' },
				{ label: '/leaderboard', path: '/leaderboard' },
				{ label: '/sets/[id]/podium (TV)', setPath: (id) => `/sets/${id}/podium` }
			]
		},
		{
			id: 'player-onboarding',
			title: 'Player — onboarding',
			links: [
				{ label: '/play/teams', path: '/play/teams' },
				{ label: '/play/teams/sets', path: '/play/teams/sets' },
				{ label: '/play/teams/randomizing', path: '/play/teams/randomizing' },
				{ label: '/play/solo', path: '/play/solo' },
				{ label: '/join (manual team picker)', path: '/join' }
			]
		},
		{
			id: 'player-ingame',
			title: 'Player — in-game',
			links: [
				{ label: '/team', path: '/team' },
				{ label: '/challenge/[id]', challengePath: (id) => `/challenge/${id}` },
				{ label: '/play/leaderboard', path: '/play/leaderboard' },
				{ label: '/play/waiting', path: '/play/waiting' },
				{ label: '/play/thanks', path: '/play/thanks' }
			]
		},
		{
			id: 'host-admin',
			title: 'Host — admin',
			links: [
				{ label: '/admin', path: '/admin' },
				{ label: '/admin/login', path: '/admin/login' },
				{ label: '/admin/settings', path: '/admin/settings' },
				{ label: '/admin/sets', path: '/admin/sets' },
				{ label: '/admin/sets/[id] (Console)', setPath: (id) => `/admin/sets/${id}` },
				{ label: '/admin/sets/[id]/lobby', setPath: (id) => `/admin/sets/${id}/lobby` },
				{ label: '/admin/sets/[id]/recap', setPath: (id) => `/admin/sets/${id}/recap` },
				{ label: '/admin/challenges', path: '/admin/challenges' },
				{ label: '/admin/challenges/[id]', challengePath: (id) => `/admin/challenges/${id}` },
				{ label: '/admin/tracks', path: '/admin/tracks' },
				{ label: '/admin/teams', path: '/admin/teams' },
				{ label: '/admin/pools', path: '/admin/pools' },
				{ label: '/admin/review', path: '/admin/review' },
				{ label: '/admin/nfc-tags', path: '/admin/nfc-tags' },
				{ label: '/admin/variant-defaults', path: '/admin/variant-defaults' },
				{ label: '/admin/live', path: '/admin/live' }
			]
		},
		{
			id: 'nfc',
			title: 'NFC handlers',
			links: [
				{ label: '/nfc/hint/[challenge_id]', challengePath: (id) => `/nfc/hint/${id}` },
				{ label: '/nfc/unlock/[challenge_id]', challengePath: (id) => `/nfc/unlock/${id}` },
				{ label: '/sets/[id]/join', setPath: (id) => `/sets/${id}/join` },
				{ label: '/sets/[id]/in-progress', setPath: (id) => `/sets/${id}/in-progress` },
				{ label: '/sets/[id]/over', setPath: (id) => `/sets/${id}/over` }
			]
		},
		{
			id: 'api',
			title: 'API endpoints',
			isApi: true,
			links: []
		}
	];

	const API_LIST = [
		'/api/auto-submit — POST, admin-polled',
		'/api/player/leave — DELETE',
		'/api/player/sweep — POST, admin-polled',
		'/api/admin/clips/bulk-delete — POST'
	];

	// ── Helpers ────────────────────────────────────────────────────────────────

	function resolvePath(link: LinkDef): string {
		if (link.path !== undefined) return link.path;
		if (link.setPath) return activeSetId ? link.setPath(activeSetId) : '';
		if (link.challengePath) return activeChallengeId ? link.challengePath(activeChallengeId) : '';
		return '';
	}

	function matchesSearch(link: LinkDef, q: string): boolean {
		if (!q) return true;
		const ql = q.toLowerCase();
		return link.label.toLowerCase().includes(ql) || resolvePath(link).toLowerCase().includes(ql);
	}

	function sectionHasMatches(section: Section, q: string): boolean {
		if (section.isApi)
			return (
				!q ||
				'api endpoints'.includes(q.toLowerCase()) ||
				API_LIST.some((e) => e.toLowerCase().includes(q.toLowerCase()))
			);
		return section.links.some((l) => matchesSearch(l, q));
	}

	// Flat ordered list of all visible navigable links (for keyboard nav)
	const allNavigableLinks = $derived(
		SECTIONS.filter((s) => !s.isApi && sectionHasMatches(s, search)).flatMap((s) =>
			s.links
				.filter((l) => matchesSearch(l, search))
				.map((l) => ({ label: l.label, path: resolvePath(l) }))
				.filter((l) => !!l.path)
		)
	);

	const focusedPath = $derived(allNavigableLinks[focusedIndex]?.path ?? null);

	function isActive(resolvedPath: string): boolean {
		if (!resolvedPath) return false;
		const cur = $page.url.pathname;
		return cur === resolvedPath || (resolvedPath !== '/' && cur.startsWith(resolvedPath + '/'));
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	/** Whether the server-side one-shot force cookie is still present (unconsumed). */
	function hasForceCookie(): boolean {
		return typeof document !== 'undefined' && /(?:^|;\s*)dev_force_powerup=[^;]+/.test(document.cookie);
	}

	onMount(() => {
		try {
			const savedOpen = localStorage.getItem('hitster_devnav_open');
			if (savedOpen !== null) open = JSON.parse(savedOpen);
			const savedCollapsed = localStorage.getItem('hitster_devnav_sections');
			if (savedCollapsed !== null) collapsed = JSON.parse(savedCollapsed);
			const savedForce = localStorage.getItem('dev_force_next_powerup');
			// Only re-arm the force if the server hasn't consumed its cookie yet. If
			// the cookie is gone, the force already fired — clear the localStorage echo
			// so it doesn't silently re-arm on this mount. (That echo defeating the
			// server's one-shot cookie delete is what made the force effectively
			// permanent, hijacking every earn until localStorage was hand-cleared.)
			if (savedForce) {
				if (hasForceCookie()) forcePowerupTypeId = savedForce;
				else localStorage.removeItem('dev_force_next_powerup');
			}
		} catch {
			// ignore malformed storage
		}

		if (open) fetchState();

		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				togglePanel();
			}
			if (e.key === 'Escape' && open) {
				e.preventDefault();
				closePanel();
			}
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	});

	$effect(() => {
		if (open) {
			fetchState();
			setTimeout(() => searchInput?.focus(), 60);
		}
	});

	$effect(() => {
		try {
			localStorage.setItem('hitster_devnav_open', JSON.stringify(open));
		} catch {
			// ignore
		}
	});

	$effect(() => {
		try {
			localStorage.setItem('hitster_devnav_sections', JSON.stringify(collapsed));
		} catch {
			// ignore
		}
	});

	// ── Actions ────────────────────────────────────────────────────────────────

	async function fetchState() {
		loading = true;
		try {
			const res = await fetch('/api/dev/state');
			if (res.ok) {
				devState = await res.json();
				if (!challengeId && devState?.recent_challenges?.length) {
					challengeId = devState.recent_challenges[0].id;
				}
			}
		} catch {
			// ignore
		} finally {
			loading = false;
		}
	}

	function togglePanel() {
		open = !open;
		if (!open) {
			search = '';
			focusedIndex = -1;
		}
	}

	function closePanel() {
		open = false;
		search = '';
		focusedIndex = -1;
	}

	function navigate(path: string) {
		if (!path) return;
		goto(path);
		closePanel();
	}

	function toggleSection(id: string) {
		collapsed = { ...collapsed, [id]: !collapsed[id] };
	}

	async function copyText(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = text;
			setTimeout(() => {
				copied = null;
			}, 1500);
		} catch {
			// ignore
		}
	}

	function handleSearchKeyDown(e: KeyboardEvent) {
		const links = allNavigableLinks;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusedIndex = Math.min(focusedIndex + 1, links.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (focusedIndex <= 0) {
				focusedIndex = -1;
			} else {
				focusedIndex = focusedIndex - 1;
			}
		} else if (e.key === 'Enter' && focusedIndex >= 0) {
			const link = links[focusedIndex];
			if (link) navigate(link.path);
		}
	}

	const TEAM_COLOR_BG: Record<string, string> = {
		blue: 'bg-blue-600',
		yellow: 'bg-yellow-500',
		green: 'bg-green-600',
		red: 'bg-red-600',
		indigo: 'bg-indigo-600',
		black: 'bg-neutral-700 border border-zinc-500'
	};

	const POWERUP_TYPES = [
		{ id: 'shield', name: 'Shield', icon: '🛡️' },
		{ id: 'time_boost', name: 'Time Boost', icon: '⏱️' },
		{ id: 'insurance', name: 'Insurance', icon: '🪙' },
		{ id: 'bonus_points', name: 'Bonus Points', icon: '✨' },
		{ id: 'hard_gaan', name: 'Hard Gaan', icon: '🔥' },
		{ id: 'single_event_mult', name: 'Single-Event Mult', icon: '🎲' },
		{ id: 'free_answer', name: 'Free Answer', icon: '💡' }
	];

	const TEAM_COLORS = ['blue', 'yellow', 'green', 'red', 'indigo', 'black'];

	// ── Powerup tools state ───────────────────────────────────────────────────
	let forcePowerupTypeId = $state('');
	const forcedType = $derived(POWERUP_TYPES.find((p) => p.id === forcePowerupTypeId));
	let awardTeamColor = $state('blue');
	let awardTypeId = $state('shield');
	let awardStatus = $state<'idle' | 'loading' | 'ok' | 'error'>('idle');
	let awardError = $state('');

	$effect(() => {
		try {
			localStorage.setItem('dev_force_next_powerup', forcePowerupTypeId);
		} catch {
			// ignore
		}
		// Sync cookie for server-side one-shot override
		if (forcePowerupTypeId) {
			document.cookie = `dev_force_powerup=${forcePowerupTypeId}; path=/; SameSite=Strict; Max-Age=86400`;
		} else {
			document.cookie = 'dev_force_powerup=; path=/; SameSite=Strict; Max-Age=0';
		}
	});

	async function awardPowerup() {
		if (!activeSetId) {
			awardError = 'No active set';
			awardStatus = 'error';
			return;
		}
		awardStatus = 'loading';
		awardError = '';
		try {
			const res = await fetch('/api/dev/award-powerup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ team_color: awardTeamColor, powerup_type_id: awardTypeId, set_id: activeSetId })
			});
			const data = await res.json();
			if (!res.ok) {
				awardStatus = 'error';
				awardError = data.error ?? 'Failed';
			} else {
				awardStatus = 'ok';
				setTimeout(() => (awardStatus = 'idle'), 2000);
			}
		} catch {
			awardStatus = 'error';
			awardError = 'Network error';
		}
	}

	const PLAY_STATE_COLOR: Record<string, string> = {
		joining: 'text-yellow-400',
		playing: 'text-lime-400',
		recap: 'text-purple-400'
	};
</script>

<!-- Backdrop -->
{#if open}
	<div
		class="fixed inset-0 z-[9997]"
		role="presentation"
		onclick={closePanel}
		aria-hidden="true"
	></div>
{/if}

<!-- Panel -->
{#if open}
	<div
		class="fixed top-0 left-0 z-[9998] flex h-screen w-[380px] flex-col overflow-hidden border-r border-zinc-700 bg-zinc-950 font-mono text-sm shadow-2xl"
		transition:fly={{ x: -380, duration: 180, opacity: 1 }}
		role="dialog"
		aria-label="Dev navigation"
	>
		<!-- Header -->
		<div class="flex shrink-0 items-center justify-between border-b border-zinc-700 px-4 py-3">
			<div class="flex items-center gap-2">
				<Terminal size={14} class="text-lime-400" />
				<span class="text-xs font-bold tracking-widest text-lime-400 uppercase">Dev Nav</span>
				{#if loading}
					<RefreshCw size={10} class="animate-spin text-zinc-500" />
				{/if}
				{#if forcePowerupTypeId}
					<span
						class="rounded border border-amber-500/50 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300"
						title="A powerup force is armed — it fires once on the next earn"
					>
						⚠ FORCE: {forcedType?.name ?? forcePowerupTypeId}
					</span>
				{/if}
			</div>
			<button
				onclick={closePanel}
				class="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
				aria-label="Close dev nav"
			>
				<X size={14} />
			</button>
		</div>

		<!-- Search -->
		<div class="shrink-0 border-b border-zinc-700 px-3 py-2">
			<input
				bind:this={searchInput}
				bind:value={search}
				oninput={() => {
					focusedIndex = -1;
				}}
				onkeydown={handleSearchKeyDown}
				placeholder="Filter routes…"
				class="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-lime-600 focus:ring-1 focus:ring-lime-600/30"
				autocomplete="off"
				spellcheck={false}
			/>
		</div>

		<!-- Body -->
		<div class="flex-1 overflow-y-auto">
			<!-- Context block -->
			{#if !search}
				<div class="border-b border-zinc-700 px-3 py-3 text-xs">
					<!-- Current path -->
					<div class="mb-3">
						<span class="text-zinc-500">path</span>
						<span class="ml-2 font-bold text-lime-300">{$page.url.pathname}</span>
					</div>

					<!-- Login state -->
					<div class="mb-3">
						<span class="text-zinc-500">auth</span>
						{#if devState?.user}
							<span class="ml-2 text-zinc-300">{devState.user.email ?? devState.user.id}</span>
						{:else if devState}
							<span class="ml-2 text-zinc-500 italic">not logged in</span>
						{:else}
							<span class="ml-2 text-zinc-600 italic">loading…</span>
						{/if}
					</div>

					<!-- Team cookie -->
					<div class="mb-3 flex items-center gap-2">
						<span class="text-zinc-500">team</span>
						{#if devState?.team_cookie}
							<span class="inline-flex items-center gap-1.5">
								<span
									class="inline-block h-3 w-3 rounded-sm {TEAM_COLOR_BG[devState.team_cookie] ??
										'bg-zinc-600'}"
								></span>
								<span class="text-zinc-300">{devState.team_cookie}</span>
							</span>
							<button
								onclick={() => navigate('/join')}
								class="ml-auto text-zinc-600 underline hover:text-zinc-400">change</button
							>
						{:else if devState}
							<span class="ml-2 text-zinc-500 italic">no cookie</span>
							<button
								onclick={() => navigate('/join')}
								class="ml-auto text-zinc-600 underline hover:text-zinc-400">set team</button
							>
						{:else}
							<span class="ml-2 text-zinc-600 italic">loading…</span>
						{/if}
					</div>

					<!-- Active set -->
					{#if devState?.active_set}
						{@const s = devState.active_set}
						<div class="mt-3 rounded border border-lime-800/50 bg-lime-950/30 p-2.5">
							<div class="mb-1.5 flex items-center gap-2">
								<span class="text-zinc-400">active set</span>
								<span
									class="rounded px-1 text-[10px] uppercase {PLAY_STATE_COLOR[s.play_state] ??
										'text-zinc-400'}">{s.play_state}</span
								>
							</div>
							<div class="mb-2 flex items-center gap-1">
								<span class="truncate font-bold text-lime-300">{s.name}</span>
								<button
									onclick={() => copyText(s.id)}
									class="ml-1 shrink-0 text-zinc-600 hover:text-zinc-300"
									title={s.id}
									aria-label="Copy set ID"
								>
									{#if copied === s.id}
										<Check size={11} class="text-lime-400" />
									{:else}
										<Copy size={11} />
									{/if}
								</button>
							</div>
							<div class="flex flex-wrap gap-1">
								<button
									onclick={() => navigate(`/admin/sets/${s.id}`)}
									class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-lime-900 hover:text-lime-300"
									>Console</button
								>
								<button
									onclick={() => navigate(`/admin/sets/${s.id}/lobby`)}
									class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-lime-900 hover:text-lime-300"
									>Lobby</button
								>
								<button
									onclick={() => navigate(`/admin/sets/${s.id}/recap`)}
									class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-lime-900 hover:text-lime-300"
									>Recap</button
								>
								<button
									onclick={() => navigate(`/sets/${s.id}/podium`)}
									class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-lime-900 hover:text-lime-300"
									>Podium TV</button
								>
								<button
									onclick={() => navigate('/admin/live')}
									class="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-lime-900 hover:text-lime-300"
									>Live</button
								>
							</div>
						</div>
					{:else if devState}
						<!-- No active set — show override input and recent sets dropdown -->
						<div class="mt-3 rounded border border-zinc-700 p-2.5">
							<div class="mb-2 text-zinc-500">no active set</div>
							{#if devState.recent_sets.length}
								<select
									bind:value={setIdOverride}
									class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-lime-600"
								>
									<option value="">— pick a recent set —</option>
									{#each devState.recent_sets as rs}
										<option value={rs.id}>[{rs.status}] {rs.name}</option>
									{/each}
								</select>
							{/if}
							<input
								bind:value={setIdOverride}
								placeholder="or paste set UUID…"
								class="mt-1.5 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 placeholder-zinc-600 outline-none focus:border-lime-600"
							/>
						</div>
					{/if}

					<!-- Challenge selector -->
					{#if devState?.recent_challenges?.length}
						<div class="mt-2">
							<label class="mb-1 block text-zinc-500">challenge</label>
							<select
								bind:value={challengeId}
								class="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-lime-600"
							>
								{#each devState.recent_challenges as rc}
									<option value={rc.id}>[{rc.variant}] {rc.name}</option>
								{/each}
							</select>
						</div>
					{/if}

					<button onclick={fetchState} class="mt-2.5 text-[11px] text-zinc-600 hover:text-zinc-400"
						>↻ refresh context</button
					>

					<!-- Powerups tools -->
					<div class="mt-3 border-t border-zinc-800 pt-3">
						<div class="mb-2 text-[11px] font-bold tracking-wider text-purple-400 uppercase">
							Powerups
						</div>

						<!-- Tool A: Force next powerup -->
						<div class="mb-2">
							<div class="mb-1 text-[11px] text-zinc-500">Force next</div>
							<div class="flex gap-1">
								<select
									bind:value={forcePowerupTypeId}
									class="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-purple-600"
								>
									<option value="">Random (default)</option>
									{#each POWERUP_TYPES as pt}
										<option value={pt.id}>{pt.icon} {pt.name}</option>
									{/each}
								</select>
								{#if forcePowerupTypeId}
									<button
										onclick={() => (forcePowerupTypeId = '')}
										class="shrink-0 rounded border border-zinc-700 px-2 text-[11px] text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
										title="Clear override"
									>✕</button>
								{/if}
							</div>
							{#if forcePowerupTypeId}
								<div
									class="mt-1 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-300"
								>
									⚠ FORCE ARMED: {forcedType?.icon}
									{forcedType?.name ?? forcePowerupTypeId} — fires once on next earn, then clears
								</div>
							{/if}
						</div>

						<!-- Tool B: Award directly -->
						<div>
							<div class="mb-1 text-[11px] text-zinc-500">
								Award direct {#if !activeSetId}<span class="text-red-500">(no active set)</span>{/if}
							</div>
							<div class="mb-1 flex gap-1">
								<select
									bind:value={awardTeamColor}
									class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-purple-600"
								>
									{#each TEAM_COLORS as c}
										<option value={c}>
											<span class={TEAM_COLOR_BG[c]}></span>{c}
										</option>
									{/each}
								</select>
								<select
									bind:value={awardTypeId}
									class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-purple-600"
								>
									{#each POWERUP_TYPES as pt}
										<option value={pt.id}>{pt.icon} {pt.name}</option>
									{/each}
								</select>
							</div>
							<button
								onclick={awardPowerup}
								disabled={awardStatus === 'loading' || !activeSetId}
								class="w-full rounded border border-purple-800 bg-purple-950/50 px-2 py-1 text-[11px] font-semibold text-purple-300 transition hover:bg-purple-900/50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{awardStatus === 'loading'
									? 'Awarding…'
									: awardStatus === 'ok'
										? '✓ Awarded!'
										: 'Award (held)'}
							</button>
							{#if awardStatus === 'error'}
								<div class="mt-0.5 text-[10px] text-red-400">{awardError}</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			<!-- Route sections -->
			{#each SECTIONS as section}
				{#if sectionHasMatches(section, search)}
					<div class="border-b border-zinc-800/60">
						<!-- Section header -->
						<button
							onclick={() => toggleSection(section.id)}
							class="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-bold tracking-wider text-zinc-500 uppercase hover:text-zinc-300"
						>
							{#if collapsed[section.id]}
								<ChevronRight size={11} />
							{:else}
								<ChevronDown size={11} />
							{/if}
							{section.title}
						</button>

						{#if !collapsed[section.id]}
							{#if section.isApi}
								<!-- API info block -->
								<div class="mx-3 mb-3 rounded border border-zinc-800 bg-zinc-900 px-3 py-2">
									{#each API_LIST as endpoint}
										{#if !search || endpoint.toLowerCase().includes(search.toLowerCase())}
											<div class="py-0.5 text-[11px] text-zinc-500">{endpoint}</div>
										{/if}
									{/each}
								</div>
							{:else}
								<!-- Route links -->
								<ul class="mb-1 px-2">
									{#each section.links as link}
										{#if matchesSearch(link, search)}
											{@const resolvedPath = resolvePath(link)}
											{@const isDynamic = !!link.setPath || !!link.challengePath}
											{@const usesActiveSet = !!link.setPath && !!devState?.active_set}
											{@const active = isActive(resolvedPath)}
											{@const focused = resolvedPath === focusedPath}
											<li>
												<button
													onclick={() => navigate(resolvedPath)}
													disabled={!resolvedPath}
													class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors
														{active ? 'bg-lime-950/40 text-lime-300' : 'text-zinc-400 hover:text-zinc-100'}
														{focused ? 'bg-zinc-700 text-zinc-100' : ''}
														{!resolvedPath ? 'cursor-not-allowed opacity-30' : 'hover:bg-zinc-800'}
													"
												>
													{#if active}
														<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-lime-400"></span>
													{:else if isDynamic}
														<span
															class="h-1.5 w-1.5 shrink-0 rounded-full {resolvedPath
																? 'bg-zinc-600'
																: 'bg-zinc-800'}"
														></span>
													{:else}
														<span class="h-1.5 w-1.5 shrink-0"></span>
													{/if}
													<span class="flex-1 truncate">{link.label}</span>
													{#if usesActiveSet}
														<span
															class="shrink-0 rounded bg-lime-900/60 px-1 text-[10px] text-lime-500"
															>active</span
														>
													{:else if isDynamic && !resolvedPath}
														<span class="shrink-0 text-[10px] text-zinc-600">(no id)</span>
													{/if}
												</button>
											</li>
										{/if}
									{/each}
								</ul>
							{/if}
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		<!-- Footer -->
		<div class="shrink-0 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
			Build: dev &nbsp;·&nbsp; hitster-app
		</div>
	</div>
{/if}

<!-- FAB -->
<button
	onclick={togglePanel}
	class="fixed bottom-4 left-4 z-[9999] flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 font-mono text-zinc-400 shadow-lg transition-colors hover:border-lime-700 hover:bg-zinc-800 hover:text-lime-400 focus:ring-2 focus:ring-lime-600/50 focus:outline-none"
	aria-label="Toggle dev navigation"
	title="Dev Nav (⌘K)"
>
	<Terminal size={18} />
</button>
<!-- FAB label -->
<span
	class="pointer-events-none fixed bottom-0.5 left-4 z-[9999] w-11 text-center font-mono text-[9px] tracking-wider text-zinc-600 uppercase"
	>dev</span
>
