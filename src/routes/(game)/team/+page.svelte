<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import TutorialOverlay from '$lib/components/game/TutorialOverlay.svelte';
	import HeldPowerups from '$lib/components/game/HeldPowerups.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let liveScore = $state(data.team.score);
	let livePosition = $state(data.position);
	let livePlayState = $state(data.activeSet?.play_state ?? 'playing');

	// Lobby realtime: players joining teams
	type LobbyPlayer = {
		id: string;
		display_name: string;
		photo_url: string | null;
		team_id: string | null;
	};
	let lobbyTeams = $state(data.lobbyTeams.map((t) => ({ ...t, players: [...t.players] })));

	let showTutorials = $state(false);

	const teamColors: Record<string, { bg: string; border: string; text: string }> = {
		blue: { bg: '#3b82f6', border: '#2563eb', text: '#fff' },
		yellow: { bg: '#eab308', border: '#ca8a04', text: '#000' },
		green: { bg: '#22c55e', border: '#16a34a', text: '#000' },
		red: { bg: '#ef4444', border: '#dc2626', text: '#fff' },
		indigo: { bg: '#6366f1', border: '#4f46e5', text: '#fff' },
		black: { bg: '#1e293b', border: '#0f172a', text: '#fff' }
	};

	const c = $derived(
		teamColors[data.team.color] ?? { bg: '#6b7280', border: '#4b5563', text: '#fff' }
	);

	const ordinal = (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	};

	function formatActivity(event_type: string, payload: unknown): string {
		if (event_type === 'team_entry') return 'Joined via entry card';
		if (event_type === 'challenge_submit') {
			const p = payload as { challenge_title?: string; score?: number } | null;
			return p?.challenge_title
				? `Submitted "${p.challenge_title}" · ${p.score ?? 0} pts`
				: 'Submitted a challenge';
		}
		return event_type.replace(/_/g, ' ');
	}

	const isLocked = (challengeId: string) => {
		const ch = data.challenges.find((c) => c.id === challengeId);
		const required = ch?.nfc_lock_override ?? data.activeSet?.nfc_lock_enabled ?? false;
		return required && !data.challengeUnlocks.includes(challengeId);
	};

	onMount(() => {
		// Score + position realtime
		const teamChannel = supabaseBrowser
			.channel(`team-home-${data.team.id}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'teams',
					filter: `id=eq.${data.team.id}`
				},
				async (payload) => {
					liveScore = (payload.new as { score: number }).score;
					const { data: allTeams } = await supabaseBrowser
						.from('teams')
						.select('id, score')
						.order('score', { ascending: false });
					if (allTeams) {
						livePosition = allTeams.findIndex((t) => t.id === data.team.id) + 1 || 1;
					}
				}
			)
			.subscribe();

		// Game set state realtime (transitions joining → playing → recap)
		let setChannel: ReturnType<typeof supabaseBrowser.channel> | undefined;
		if (data.activeSet?.id) {
			setChannel = supabaseBrowser
				.channel(`team-set-state-${data.activeSet.id}`)
				.on(
					'postgres_changes',
					{
						event: 'UPDATE',
						schema: 'public',
						table: 'game_sets',
						filter: `id=eq.${data.activeSet.id}`
					},
					(payload) => {
						const newState = (payload.new as { play_state?: string; recap_state?: string })
							.play_state;
						const recapState = (payload.new as { recap_state?: string }).recap_state;
						if (newState) livePlayState = newState;
						if (newState === 'recap' && data.activeSet) {
							window.location.href = `/play/waiting?set_id=${data.activeSet.id}`;
						}
						if (recapState === 'complete' && data.activeSet) {
							window.location.href = `/play/thanks?set_id=${data.activeSet.id}`;
						}
					}
				)
				.subscribe();

			// Lobby: players joining realtime
			if (data.activeSet.play_state === 'joining') {
				supabaseBrowser
					.channel(`team-lobby-players-${data.activeSet.id}`)
					.on(
						'postgres_changes',
						{
							event: '*',
							schema: 'public',
							table: 'players',
							filter: `set_id=eq.${data.activeSet.id}`
						},
						(payload) => {
							if (payload.eventType === 'DELETE') return;
							const p = payload.new as LobbyPlayer;
							// Remove player from all teams, then add to new team
							lobbyTeams = lobbyTeams.map((t) => ({
								...t,
								players: [
									...t.players.filter((pl) => pl.id !== p.id),
									...(p.team_id === t.id
										? [{ id: p.id, display_name: p.display_name, photo_url: p.photo_url }]
										: [])
								]
							}));
						}
					)
					.subscribe();
			}
		}

		return () => {
			supabaseBrowser.removeChannel(teamChannel);
			if (setChannel) supabaseBrowser.removeChannel(setChannel);
		};
	});
</script>

{#if showTutorials && data.setTutorials.length > 0}
	<TutorialOverlay tutorials={data.setTutorials} onclose={() => (showTutorials = false)} />
{/if}

<!-- ── LOBBY VIEW (play_state = joining) ──────────────────────────────────── -->
{#if livePlayState === 'joining' && data.activeSet}
	<!-- Team banner -->
	<div class="px-6 py-6" style="background-color: {c.bg}; border-bottom: 3px solid {c.border};">
		<div class="mx-auto flex max-w-lg items-center justify-between">
			<div>
				<div
					class="text-sm font-bold tracking-widest uppercase"
					style="color: {c.text}; opacity: 0.7;"
				>
					You are
				</div>
				<h1 class="mt-0.5 text-3xl font-black" style="color: {c.text};">
					{data.team.display_name}
				</h1>
			</div>
			{#if data.setTutorials.length > 0}
				<button
					type="button"
					onclick={() => (showTutorials = true)}
					class="rounded-xl border-2 px-4 py-2 text-sm font-bold transition-opacity hover:opacity-80"
					style="border-color: rgba(255,255,255,0.5); color: {c.text};"
				>
					Tutorials
				</button>
			{/if}
		</div>
	</div>

	<div class="mx-auto max-w-lg space-y-5 p-5">
		<!-- Set name -->
		<div class="text-center">
			<div class="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Game set</div>
			<div class="mt-0.5 text-lg font-black text-white">{data.activeSet.name}</div>
		</div>

		<!-- Teams + joined players -->
		<div>
			<h2 class="mb-3 text-xs font-bold tracking-widest text-zinc-500 uppercase">Teams</h2>
			<div class="space-y-2">
				{#each lobbyTeams as t}
					{@const tc = teamColors[t.color] ?? { bg: '#6b7280', border: '#4b5563', text: '#fff' }}
					<div class="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
						<div class="mb-2 flex items-center gap-2">
							<div class="h-3 w-3 rounded-full" style="background-color: {tc.bg};"></div>
							<span class="text-sm font-semibold text-white">{t.display_name}</span>
							<span class="ml-auto text-xs text-zinc-600">{t.players.length} joined</span>
						</div>
						{#if t.players.length > 0}
							<div class="flex flex-wrap gap-2">
								{#each t.players as p}
									<div class="flex items-center gap-1.5">
										{#if p.photo_url}
											<img
												src={p.photo_url}
												alt={p.display_name}
												class="h-6 w-6 rounded-full object-cover"
											/>
										{:else}
											<div
												class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
												style="background-color: {tc.bg}33; color: {tc.bg};"
											>
												{p.display_name.charAt(0)}
											</div>
										{/if}
										<span class="text-xs text-zinc-400">{p.display_name}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>

		<div class="flex items-center gap-2 py-2 text-sm text-zinc-600">
			<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
			Waiting for the host to start the game…
		</div>
	</div>

	<!-- ── TEAM CONSOLE (play_state = playing) ──────────────────────────────── -->
{:else}
	<!-- Team banner -->
	<div class="px-6 py-8" style="background-color: {c.bg}; border-bottom: 3px solid {c.border};">
		<div class="mx-auto max-w-lg">
			<div
				class="text-sm font-bold tracking-widest uppercase"
				style="color: {c.text}; opacity: 0.7;"
			>
				You are
			</div>
			<h1 class="mt-1 text-4xl font-black" style="color: {c.text};">{data.team.display_name}</h1>
		</div>
	</div>

	<div class="mx-auto max-w-lg space-y-6 p-6">
		<!-- Score + position -->
		<div class="grid grid-cols-2 gap-4">
			<div class="rounded-2xl bg-zinc-900 p-5 text-center">
				<div class="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Score</div>
				<div class="mt-1 text-5xl font-black text-white tabular-nums">{liveScore}</div>
				<div class="mt-1 text-xs text-zinc-600">points</div>
			</div>
			<div class="rounded-2xl bg-zinc-900 p-5 text-center">
				<div class="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Position</div>
				<div class="mt-1 text-5xl font-black tabular-nums" style="color: {c.bg};">
					{ordinal(livePosition)}
				</div>
				<div class="mt-1 text-xs text-zinc-600">of {data.totalTeams} teams</div>
			</div>
		</div>

		<!-- Stats + action row -->
		{#if data.activeSet}
			<div class="text-sm text-zinc-500">
				<span class="font-bold text-white">{data.setCompletedCount}</span>
				/ {data.setTotalCount} challenges done
			</div>
		{/if}

		<!-- Held powerups -->
		{#if data.playerSetId && data.heldPowerups}
			<HeldPowerups
				teamId={data.team.id}
				setId={data.playerSetId}
				powerups={data.heldPowerups}
			/>
		{/if}

		<!-- Action buttons row -->
		<div class="grid grid-cols-2 gap-3 {data.setTutorials.length > 0 ? 'sm:grid-cols-3' : ''}">
			{#if data.activeSet?.status === 'active'}
				<a
					href="/play/leaderboard"
					class="flex items-center justify-center rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
				>
					Leaderboard
				</a>
			{:else}
				<a
					href="/leaderboard"
					class="flex items-center justify-center rounded-xl border border-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
				>
					Leaderboard
				</a>
			{/if}
			{#if data.setTutorials.length > 0}
				<button
					type="button"
					onclick={() => (showTutorials = true)}
					class="rounded-xl border px-4 py-3 text-sm font-semibold transition-colors"
					style="border-color: {c.bg}44; color: {c.bg}; background-color: {c.bg}11;"
				>
					Tutorials
				</button>
			{/if}
		</div>

		<!-- Challenges -->
		<div>
			<h2 class="mb-3 text-xs font-bold tracking-widest text-zinc-500 uppercase">Challenges</h2>
			{#if data.challenges.length === 0}
				<p class="text-sm text-zinc-600">No active challenges yet — check back soon.</p>
			{:else}
				<div class="space-y-2">
					{#each data.challenges as ch}
						{@const locked = isLocked(ch.id)}
						<div
							class="flex items-center justify-between rounded-xl px-4 py-3
							{locked ? 'bg-zinc-900/50 opacity-60' : 'bg-zinc-900'}"
						>
							<div>
								<div class="font-semibold {locked ? 'text-zinc-500' : 'text-zinc-100'}">
									{ch.title}
								</div>
								<div class="text-xs text-zinc-500 capitalize">{ch.variant}</div>
							</div>
							{#if locked}
								<div class="text-right">
									<div class="text-xs text-zinc-600">🔒 Scan tag to unlock</div>
								</div>
							{:else if ch.status === 'completed'}
								<div class="text-right">
									<div class="text-xs font-bold tracking-wide text-green-400 uppercase">Done</div>
									<div class="text-sm font-black text-white">+{ch.earnedScore ?? 0} pts</div>
								</div>
							{:else}
								<a
									href="/challenge/{ch.id}"
									class="rounded-lg px-3 py-1.5 text-xs font-bold tracking-wide text-white uppercase transition-opacity hover:opacity-80"
									style="background-color: {c.bg};"
								>
									Play
								</a>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Recent activity -->
		{#if data.recentActivity.length > 0}
			<div>
				<h2 class="mb-3 text-xs font-bold tracking-widest text-zinc-500 uppercase">
					Recent activity
				</h2>
				<div class="space-y-1.5">
					{#each data.recentActivity as entry}
						<div class="flex items-center gap-2 rounded-lg bg-zinc-900/60 px-3 py-2 text-sm">
							<div
								class="h-1.5 w-1.5 shrink-0 rounded-full"
								style="background-color: {c.bg};"
							></div>
							<span class="text-zinc-300">
								{formatActivity(entry.event_type, entry.payload)}
							</span>
							<span class="ml-auto text-xs text-zinc-600 tabular-nums">
								{new Date(entry.created_at).toLocaleTimeString([], {
									hour: '2-digit',
									minute: '2-digit'
								})}
							</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}
