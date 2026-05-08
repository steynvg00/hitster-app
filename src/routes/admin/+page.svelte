<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData, ActionData } from './$types';
	import '$lib/styles/themes.css';
	import { themeStore } from '$lib/stores/theme.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let avatarMenuOpen = $state(false);
	let runningLastSet = $state(false);
	let startingGame = $state(false);
	let endingGame = $state(false);
	let endGameForm = $state<HTMLFormElement | null>(null);
	let timerExpired = $state(false);

	// Live play_state + started_at — updated via realtime
	let livePlayState = $state<'joining' | 'playing' | 'recap' | null>(
		data.activeSet?.play_state ?? null
	);
	let gameStartedAt = $state<string | null>(data.activeSet?.started_at ?? null);

	// Realtime-updated player count
	let livePlayerCount = $state(data.activeSet?.player_count ?? 0);

	// Countdown state (updated every second from the interval)
	let timerRemaining = $state<number | null>(null);

	function updateTimer() {
		if (!data.activeSet?.total_timer_seconds || !gameStartedAt || livePlayState !== 'playing') {
			timerRemaining = null;
			return;
		}
		const startMs = new Date(gameStartedAt).getTime();
		const totalMs = data.activeSet.total_timer_seconds * 1000;
		const rem = Math.max(0, Math.ceil((totalMs - (Date.now() - startMs)) / 1000));
		timerRemaining = rem;
	}

	// Auto-end game when countdown reaches zero
	$effect(() => {
		if (timerRemaining === 0 && !timerExpired && livePlayState === 'playing') {
			timerExpired = true;
			endGameForm?.requestSubmit();
		}
	});

	function fmtTimer(s: number) {
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	onMount(() => {
		themeStore.init();
		updateTimer();
		const clockIv = setInterval(updateTimer, 1000);

		if (!data.activeSet) return () => clearInterval(clockIv);

		const setChannel = supabaseBrowser
			.channel('dashboard-set')
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'game_sets',
					filter: `id=eq.${data.activeSet.id}`
				},
				(payload) => {
					livePlayState = payload.new.play_state as typeof livePlayState;
					gameStartedAt = payload.new.started_at as string | null;
					if (payload.new.play_state !== 'playing') timerExpired = false;
				}
			)
			.subscribe();

		const playerChannel = supabaseBrowser
			.channel('dashboard-players')
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'players',
					filter: `set_id=eq.${data.activeSet.id}`
				},
				() => {
					supabaseBrowser
						.from('players')
						.select('*', { count: 'exact', head: true })
						.eq('set_id', data.activeSet!.id)
						.then(({ count }) => {
							if (count !== null) livePlayerCount = count;
						});
				}
			)
			.subscribe();

		return () => {
			clearInterval(clockIv);
			supabaseBrowser.removeChannel(setChannel);
			supabaseBrowser.removeChannel(playerChannel);
		};
	});

	function getInitial(name: string) {
		return name.charAt(0).toUpperCase();
	}

	const countTiles = [
		{ href: '/admin/sets', label: 'Sets', icon: '🎮', value: () => data.stats.sets },
		{ href: '/admin/challenges', label: 'Challenges', icon: '🎯', value: () => data.stats.challenges },
		{ href: '/admin/tracks', label: 'Tracks', icon: '🎵', value: () => data.stats.tracks },
		{ href: '/admin/nfc-tags', label: 'NFC Tags', icon: '📲', value: () => data.stats.nfcTags }
	];
</script>

<svelte:window onclick={() => (avatarMenuOpen = false)} />

<div
	class="dashboard-theme theme-{themeStore.current} bg-zinc-950 font-[Nunito,sans-serif]"
	data-play-state={livePlayState ?? 'none'}
>
	<!-- Animated background elements -->
	<div class="theme-bg" aria-hidden="true">
		{#if themeStore.current === 'sound_reactive'}
			<div class="eq-bars">
				{#each Array.from({ length: 32 }, (_, i) => i) as i}
					<span style="--i:{i}"></span>
				{/each}
			</div>
		{:else if themeStore.current === 'max_defqon'}
			<div class="laser-beam"></div>
			<div class="particles">
				{#each Array.from({ length: 15 }, (_, i) => i) as i}
					<span style="--i:{i}"></span>
				{/each}
			</div>
		{:else if themeStore.current === 'mainstage'}
			<!-- Stage truss SVG + light cones -->
			<div class="mainstage-beams">
				<svg viewBox="0 0 1200 420" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">
					<defs>
						<linearGradient id="beam-white" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
							<stop offset="100%" stop-color="rgba(255,255,255,0)"/>
						</linearGradient>
						<linearGradient id="beam-red" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="rgba(220,38,38,0.2)"/>
							<stop offset="100%" stop-color="rgba(220,38,38,0)"/>
						</linearGradient>
						<linearGradient id="beam-blue" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="rgba(59,130,246,0.2)"/>
							<stop offset="100%" stop-color="rgba(59,130,246,0)"/>
						</linearGradient>
					</defs>
					<!-- Light cones -->
					<polygon class="mainstage-beam-a" points="180,72 160,400 200,400" fill="url(#beam-white)" style="mix-blend-mode:screen"/>
					<polygon class="mainstage-beam-b" points="360,72 310,420 410,420" fill="url(#beam-red)" style="mix-blend-mode:screen"/>
					<polygon class="mainstage-beam-a" points="600,72 530,420 670,420" fill="url(#beam-white)" style="mix-blend-mode:screen"/>
					<polygon class="mainstage-beam-c" points="840,72 790,420 890,420" fill="url(#beam-blue)" style="mix-blend-mode:screen"/>
					<polygon class="mainstage-beam-b" points="1020,72 1000,400 1040,400" fill="url(#beam-white)" style="mix-blend-mode:screen"/>
					<!-- Top truss horizontal beam -->
					<rect x="60" y="56" width="1080" height="18" fill="#2a2a2a" rx="2"/>
					<rect x="60" y="68" width="1080" height="4" fill="#1a1a1a"/>
					<!-- X-bracing on truss -->
					{#each Array.from({ length: 18 }, (_, i) => i) as i}
						<line x1={60 + i * 60} y1="56" x2={60 + (i + 1) * 60} y2="74" stroke="#3a3a3a" stroke-width="1.5"/>
						<line x1={60 + i * 60} y1="74" x2={60 + (i + 1) * 60} y2="56" stroke="#3a3a3a" stroke-width="1.5"/>
					{/each}
					<!-- Hanging light fixtures -->
					{#each [180, 360, 600, 840, 1020] as x}
						<rect x={x - 5} y="74" width="10" height="20" fill="#2a2a2a"/>
						<ellipse cx={x} cy="100" rx="12" ry="8" fill="#1e1e1e" stroke="#3a3a3a" stroke-width="1"/>
						<ellipse cx={x} cy="100" rx="5" ry="3" fill="#dc2626" opacity="0.7"/>
					{/each}
					<!-- Left side tower -->
					<rect x="60" y="56" width="10" height="320" fill="#2a2a2a" rx="2"/>
					{#each Array.from({ length: 10 }, (_, i) => i) as i}
						<line x1="60" y1={56 + i * 32} x2="70" y2={56 + (i + 1) * 32} stroke="#3a3a3a" stroke-width="1.5"/>
						<line x1="70" y1={56 + i * 32} x2="60" y2={56 + (i + 1) * 32} stroke="#3a3a3a" stroke-width="1.5"/>
					{/each}
					<!-- Right side tower -->
					<rect x="1130" y="56" width="10" height="320" fill="#2a2a2a" rx="2"/>
					{#each Array.from({ length: 10 }, (_, i) => i) as i}
						<line x1="1130" y1={56 + i * 32} x2="1140" y2={56 + (i + 1) * 32} stroke="#3a3a3a" stroke-width="1.5"/>
						<line x1="1140" y1={56 + i * 32} x2="1130" y2={56 + (i + 1) * 32} stroke="#3a3a3a" stroke-width="1.5"/>
					{/each}
				</svg>
			</div>
			<!-- Smoke/haze -->
			<div class="mainstage-haze"></div>
			<!-- Ambient particles -->
			<div class="mainstage-particles">
				{#each Array.from({ length: 14 }, (_, i) => i) as i}
					<span style="--i:{i}"></span>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Content above background -->
	<div class="theme-content">
		<!-- Top bar — avatar only -->
		<header class="flex items-center justify-end border-b border-zinc-800 px-6 py-3">
		<div class="relative">
			<button
				onclick={(e) => {
					e.stopPropagation();
					avatarMenuOpen = !avatarMenuOpen;
				}}
				class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-amber-400 text-sm font-bold text-zinc-950 ring-2 ring-transparent transition hover:ring-amber-400/50"
			>
				{#if data.user.avatarUrl}
					<img src={data.user.avatarUrl} alt={data.user.displayName} class="h-full w-full object-cover" />
				{:else}
					{getInitial(data.user.displayName)}
				{/if}
			</button>

			{#if avatarMenuOpen}
				<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
				<div
					class="absolute right-0 top-11 z-50 w-48 rounded-xl border border-zinc-800 bg-zinc-900 py-1 shadow-xl"
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => e.stopPropagation()}
				>
					<div class="border-b border-zinc-800 px-4 py-2.5">
						<div class="text-sm font-medium text-zinc-200">{data.user.displayName}</div>
						{#if data.user.email}
							<div class="truncate text-xs text-zinc-500">{data.user.email}</div>
						{/if}
					</div>
					<a
						href="/admin/settings"
						class="flex items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
					>
						Settings
					</a>
					<a
						href="/admin/logout"
						class="flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-zinc-800"
					>
						Log out
					</a>
				</div>
			{/if}
		</div>
	</header>

	<main class="relative flex-1 p-6">
		<!-- Tactical theme LIVE indicator -->
		<div class="tactical-live-dot pointer-events-none absolute right-6 top-16 z-20 hidden items-center gap-2">
			<span class="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"></span>
			<span class="text-xs font-bold tracking-widest text-red-400">LIVE</span>
		</div>

		<div class="mx-auto max-w-2xl space-y-6">
			<!-- Error -->
			{#if form?.error}
				<div class="rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
					{form.error}
				</div>
			{/if}

			<!-- Status panel -->
			{#if data.activeSet && livePlayState === 'joining'}
				<!-- Joining phase: accepting players, game not yet started -->
				<div class="dash-status dash-status--joining rounded-2xl border border-amber-800/50 bg-amber-950/20 p-6">
					<div class="mb-1 text-xs font-semibold uppercase tracking-widest text-amber-400">
						Accepting players
					</div>
					<h2 class="mb-4 text-2xl font-black text-white">{data.activeSet.name}</h2>
					<div class="mb-4 flex gap-6 text-sm text-zinc-400">
						<span><span class="font-bold text-zinc-200">{data.activeSet.team_count}</span> teams</span>
						<span>
							<span class="font-bold text-zinc-200">{livePlayerCount}</span> players joined
						</span>
					</div>
					{#if livePlayerCount === 0}
						<p class="mb-4 text-sm text-zinc-500">Waiting for players to join...</p>
					{/if}
					<div class="flex flex-wrap gap-3">
						<form
							method="POST"
							action="?/startGame"
							use:enhance={() => {
								startingGame = true;
								return async ({ update }) => {
									await update({ reset: false });
									startingGame = false;
								};
							}}
						>
							<button
								type="submit"
								disabled={startingGame}
								class="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-green-500 disabled:opacity-50"
							>
								{startingGame ? 'Starting…' : 'Start the game →'}
							</button>
						</form>
						<a
							href="/admin/sets/{data.activeSet.id}/lobby"
							class="inline-block rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
						>
							View lobby
						</a>
					</div>
				</div>
			{:else if data.activeSet && livePlayState === 'playing'}
				<!-- Playing phase: game in progress -->
				<div
					class="dash-status dash-status--playing rounded-2xl border border-green-800/50 bg-green-950/30 p-6
						{timerRemaining !== null && timerRemaining <= 60 ? 'dash-status--timer-critical' : ''}"
				>
					<div class="mb-1 text-xs font-semibold uppercase tracking-widest text-green-400">
						Game in progress
					</div>
					<h2 class="mb-4 text-2xl font-black text-white">{data.activeSet.name}</h2>
					<div class="mb-5 flex flex-wrap gap-6 text-sm text-zinc-400">
						<span><span class="font-bold text-zinc-200">{data.activeSet.team_count}</span> teams</span>
						<span>
							<span class="font-bold text-zinc-200">{livePlayerCount}</span> players
						</span>
						{#if timerRemaining !== null}
							<span class="flex items-center gap-1.5">
								<span
									class="tabular-nums font-bold {timerRemaining <= 60
										? 'text-red-400'
										: timerRemaining <= 300
											? 'text-yellow-400'
											: 'text-zinc-200'}"
								>
									{fmtTimer(timerRemaining)}
								</span>
								<span>remaining</span>
							</span>
						{/if}
					</div>
					<div class="flex flex-wrap gap-3">
						<a
							href="/admin/live"
							class="inline-block rounded-lg bg-green-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-green-400"
						>
							Open game status →
						</a>
						<form
							bind:this={endGameForm}
							method="POST"
							action="?/endGame"
							use:enhance={() => {
								endingGame = true;
								return async ({ update }) => {
									await update({ reset: false });
									endingGame = false;
								};
							}}
						>
							<button
								type="submit"
								disabled={endingGame}
								onclick={(e) => {
									if (!confirm('End the game now? This will stop accepting submissions.'))
										e.preventDefault();
								}}
								class="rounded-lg border border-red-800 bg-red-950/50 px-5 py-2.5 text-sm font-medium text-red-300 transition hover:bg-red-900 disabled:opacity-50"
							>
								{endingGame ? 'Ending…' : 'End game'}
							</button>
						</form>
					</div>
				</div>
			{:else if data.activeSet && livePlayState === 'recap'}
				<!-- Recap phase: podium reveal -->
				<div class="dash-status dash-status--recap rounded-2xl border border-indigo-800/50 bg-indigo-950/20 p-6">
					<div class="mb-1 text-xs font-semibold uppercase tracking-widest text-indigo-400">
						Recap playing
					</div>
					<h2 class="mb-4 text-2xl font-black text-white">{data.activeSet.name}</h2>
					<div class="mb-5 flex gap-6 text-sm text-zinc-400">
						<span><span class="font-bold text-zinc-200">{data.activeSet.team_count}</span> teams</span>
						<span>
							<span class="font-bold text-zinc-200">{livePlayerCount}</span> players joined
						</span>
					</div>
					<a
						href="/admin/sets/{data.activeSet.id}/recap"
						class="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500"
					>
						Open recap →
					</a>
				</div>
			{:else}
				<!-- No game running -->
				<div class="dash-status dash-status--idle rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
					<div class="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">Status</div>
					<h2 class="mb-4 text-2xl font-black text-zinc-400">No game running</h2>
					<div class="flex flex-wrap gap-3">
						<a
							href="/admin/sets"
							class="inline-block rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-amber-300"
						>
							Start a set
						</a>
						{#if data.lastInactiveSet}
							<form
								method="POST"
								action="?/runLastSet"
								use:enhance={() => {
									runningLastSet = true;
									return async ({ update }) => {
										await update({ reset: false });
										runningLastSet = false;
									};
								}}
							>
								<button
									type="submit"
									disabled={runningLastSet}
									class="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
								>
									{runningLastSet ? 'Starting…' : `Run "${data.lastInactiveSet.name}"`}
								</button>
							</form>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Quick action tiles -->
			<div class="grid grid-cols-3 gap-3">
				{#each countTiles as tile}
					<a
						href={tile.href}
						class="dash-tile flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-700 hover:bg-zinc-800/80"
					>
						<div class="flex items-center gap-3">
							<span class="text-xl leading-none">{tile.icon}</span>
							<span class="dash-tile-count text-2xl font-black text-white">{tile.value()}</span>
						</div>
						<span class="text-xs font-semibold uppercase tracking-widest text-zinc-500">{tile.label}</span>
					</a>
				{/each}

				<a
					href="/admin/live"
					class="dash-tile flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-700 hover:bg-zinc-800/80"
				>
					<div class="flex items-center gap-3">
						<span class="text-xl leading-none">📡</span>
						<span
							class="dash-tile-count w-fit rounded-md px-2 py-0.5 text-xs font-semibold {livePlayState === 'playing'
								? 'bg-green-500/20 text-green-400'
								: livePlayState === 'joining'
									? 'bg-amber-500/20 text-amber-400'
									: livePlayState === 'recap'
										? 'bg-indigo-500/20 text-indigo-400'
										: 'bg-zinc-700 text-zinc-400'}"
						>
							{livePlayState ?? 'idle'}
						</span>
					</div>
					<span class="text-xs font-semibold uppercase tracking-widest text-zinc-500">Game status</span>
				</a>

				<a
					href="/admin/variant-defaults"
					class="dash-tile flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-700 hover:bg-zinc-800/80"
				>
					<div class="flex items-center gap-3">
						<span class="text-xl leading-none">⚙️</span>
					</div>
					<span class="text-xs font-semibold uppercase tracking-widest text-zinc-500">Defaults</span>
				</a>
			</div>
		</div>
	</main>
	</div>
</div>
