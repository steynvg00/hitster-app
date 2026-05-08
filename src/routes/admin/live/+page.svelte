<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData } from './$types';
	import type { ActivityLogRow } from '$lib/types/database';

	let { data }: { data: PageData } = $props();

	// ── Realtime state ────────────────────────────────────────────────────────
	type TeamRow = (typeof data.teams)[number];
	type PlayerRow = (typeof data.players)[number];
	type AttemptRow = (typeof data.attempts)[number];
	type SubmissionRow = (typeof data.submissions)[number];

	let teams = $state<TeamRow[]>([...data.teams]);
	let players = $state<PlayerRow[]>([...data.players]);
	let attempts = $state<AttemptRow[]>([...data.attempts]);
	let submissions = $state<SubmissionRow[]>([...data.submissions]);
	let activity = $state<ActivityLogRow[]>([...data.activity]);

	// ── Polling state ─────────────────────────────────────────────────────────
	let pollingActive = $state(false);
	let lastPolledAt = $state<Date | null>(null);

	// ── Live clock for per-attempt timer countdown ────────────────────────────
	let now = $state(Date.now());

	// ── Team color map ────────────────────────────────────────────────────────
	const teamColorHex: Record<string, string> = {
		blue: '#3b82f6',
		yellow: '#eab308',
		green: '#22c55e',
		red: '#ef4444',
		indigo: '#6366f1',
		black: '#64748b'
	};

	// ── Derived leaderboard ───────────────────────────────────────────────────
	const sortedByScore = $derived([...teams].sort((a, b) => b.score - a.score));
	const maxScore = $derived(Math.max(...teams.map((t) => t.score), 1));

	// ── Helpers ───────────────────────────────────────────────────────────────
	function teamPlayers(teamId: string) {
		return players.filter((p) => p.team_id === teamId);
	}

	function getAttempt(challengeId: string, teamId: string) {
		return attempts.find((a) => a.challenge_id === challengeId && a.team_id === teamId);
	}

	function getSubmission(challengeId: string, teamId: string) {
		return submissions.find((s) => s.challenge_id === challengeId && s.team_id === teamId);
	}

	function cellStatus(challengeId: string, teamId: string, nowMs: number) {
		const attempt = getAttempt(challengeId, teamId);
		const sub = getSubmission(challengeId, teamId);

		if (!attempt) return { label: '—', color: 'text-zinc-700', hasAttempt: false };
		if (sub?.is_final || attempt.ended_at)
			return { label: 'Done', color: 'text-green-400', hasAttempt: true };

		const challenge = data.challenges.find((c) => c.id === challengeId);
		if (challenge?.timer_seconds && challenge.timer_seconds > 0) {
			const endsAt = new Date(attempt.started_at).getTime() + challenge.timer_seconds * 1000;
			const remaining = endsAt - nowMs;
			if (remaining <= 0) return { label: 'Expired', color: 'text-amber-400', hasAttempt: true };
			const mins = Math.floor(remaining / 60000);
			const secs = Math.floor((remaining % 60000) / 1000);
			const color =
				remaining < 30_000
					? 'text-red-400'
					: remaining < 60_000
						? 'text-yellow-400'
						: 'text-blue-400';
			return {
				label: `${mins}:${String(secs).padStart(2, '0')}`,
				color,
				hasAttempt: true
			};
		}

		return { label: 'Active', color: 'text-blue-400', hasAttempt: true };
	}

	function fmtTime(iso: string) {
		return new Date(iso).toLocaleTimeString('nl-NL', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function activityLabel(a: ActivityLogRow): string {
		const payload = a.payload as Record<string, unknown> | null;
		if (a.event_type === 'score_adjustment' && payload) {
			const delta = Number(payload.delta ?? 0);
			const sign = delta >= 0 ? '+' : '';
			return `Score adjustment (${sign}${delta}): ${payload.reason ?? ''}`;
		}
		if (a.event_type === 'challenge_closed') return 'Challenge closed';
		if (a.event_type === 'attempt_reset') return 'Attempt reset';
		return a.event_type.replace(/_/g, ' ');
	}

	function teamLabel(teamId: string | null) {
		if (!teamId) return '';
		return teams.find((t) => t.id === teamId)?.display_name ?? teamId.slice(0, 8);
	}

	// ── Realtime + polling ────────────────────────────────────────────────────
	onMount(() => {
		const clockIv = setInterval(() => {
			now = Date.now();
		}, 1000);

		const pollIv = setInterval(async () => {
			pollingActive = true;
			try {
				await Promise.all([
					fetch('/api/auto-submit', { method: 'POST' }),
					fetch('/api/player/sweep', { method: 'POST' })
				]);
			} catch {
				/* swallow network errors */
			}
			pollingActive = false;
			lastPolledAt = new Date();
		}, 10_000);

		if (!data.selectedSetId) {
			return () => {
				clearInterval(clockIv);
				clearInterval(pollIv);
			};
		}

		const setId = data.selectedSetId;
		const teamIds = data.teams.map((t) => t.id);

		const teamSub = supabaseBrowser
			.channel(`live-teams-${setId}`)
			.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams' }, (payload) => {
				teams = teams.map((t) =>
					t.id === payload.new.id ? ({ ...t, ...payload.new } as TeamRow) : t
				);
			})
			.subscribe();

		const playerSub = supabaseBrowser
			.channel(`live-players-${setId}`)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'players', filter: `set_id=eq.${setId}` },
				(payload) => {
					if (payload.eventType === 'DELETE') {
						players = players.filter((p) => p.id !== (payload.old as PlayerRow).id);
					} else {
						const p = payload.new as PlayerRow;
						const idx = players.findIndex((x) => x.id === p.id);
						if (idx >= 0) players = [...players.slice(0, idx), p, ...players.slice(idx + 1)];
						else players = [...players, p];
					}
				}
			)
			.subscribe();

		const attemptSub = supabaseBrowser
			.channel(`live-attempts-${setId}`)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'challenge_attempts' },
				(payload) => {
					if (payload.eventType === 'DELETE') {
						attempts = attempts.filter((a) => a.id !== (payload.old as AttemptRow).id);
					} else {
						const a = payload.new as AttemptRow;
						const idx = attempts.findIndex((x) => x.id === a.id);
						if (idx >= 0) attempts = [...attempts.slice(0, idx), a, ...attempts.slice(idx + 1)];
						else attempts = [...attempts, a];
					}
				}
			)
			.subscribe();

		const subSub = supabaseBrowser
			.channel(`live-subs-${setId}`)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'submissions' },
				(payload) => {
					if (payload.eventType === 'DELETE') {
						const old = payload.old as SubmissionRow;
						submissions = submissions.filter(
							(s) => !(s.challenge_id === old.challenge_id && s.team_id === old.team_id)
						);
					} else {
						const s = payload.new as SubmissionRow;
						const idx = submissions.findIndex(
							(x) => x.challenge_id === s.challenge_id && x.team_id === s.team_id
						);
						if (idx >= 0)
							submissions = [...submissions.slice(0, idx), s, ...submissions.slice(idx + 1)];
						else submissions = [...submissions, s];
					}
				}
			)
			.subscribe();

		const actSub = supabaseBrowser
			.channel(`live-activity-${setId}`)
			.on(
				'postgres_changes',
				{ event: 'INSERT', schema: 'public', table: 'activity_log' },
				(payload) => {
					const event = payload.new as ActivityLogRow;
					if (!event.team_id || teamIds.includes(event.team_id)) {
						activity = [event, ...activity].slice(0, 30);
					}
				}
			)
			.subscribe();

		return () => {
			clearInterval(clockIv);
			clearInterval(pollIv);
			supabaseBrowser.removeChannel(teamSub);
			supabaseBrowser.removeChannel(playerSub);
			supabaseBrowser.removeChannel(attemptSub);
			supabaseBrowser.removeChannel(subSub);
			supabaseBrowser.removeChannel(actSub);
		};
	});
</script>

<div class="p-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-2xl font-bold text-white">Game status</h1>
		<div class="flex items-center gap-4">
			<div class="text-xs {pollingActive ? 'text-amber-400' : 'text-zinc-600'}">
				{#if pollingActive}
					Polling…
				{:else if lastPolledAt}
					Polled {fmtTime(lastPolledAt.toISOString())}
				{:else}
					Auto-submit armed
				{/if}
			</div>
			<div class="flex items-center gap-2 text-xs text-green-400">
				<span class="h-2 w-2 animate-pulse rounded-full bg-green-400"></span>
				Live
			</div>
		</div>
	</div>

	{#if data.activeSets.length === 0}
		<!-- Empty state -->
		<div class="flex min-h-[60vh] flex-col items-center justify-center text-center">
			<h2 class="mb-2 text-xl font-bold text-white">No game running</h2>
			<p class="mb-6 text-zinc-400">Activate a set to see live game data here.</p>
			<a
				href="/admin/sets"
				class="rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-amber-300"
			>
				Go to Sets →
			</a>
		</div>
	{:else}
		<!-- Set selector (only shown when multiple active sets with players) -->
		{#if data.activeSets.length > 1}
			<div class="mb-6 flex gap-2 overflow-x-auto pb-1">
				{#each data.activeSets as set}
					<a
						href="?set={set.id}"
						class="flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium whitespace-nowrap transition
							{set.id === data.selectedSetId
							? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
							: 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}"
					>
						{set.name}
						<span
							class="rounded-full px-1.5 py-0.5 text-xs
							{set.play_state === 'playing'
								? 'bg-green-500/20 text-green-400'
								: set.play_state === 'recap'
									? 'bg-indigo-500/20 text-indigo-400'
									: 'bg-amber-500/20 text-amber-400'}"
						>
							{set.player_count}p · {set.play_state}
						</span>
					</a>
				{/each}
			</div>
		{:else}
			<!-- Single set: just show heading -->
			<div class="mb-5 flex items-center gap-3">
				<h2 class="text-lg font-bold text-white">{data.selectedSet?.name}</h2>
				<span
					class="rounded-full px-2 py-0.5 text-xs font-semibold
					{data.selectedSet?.play_state === 'playing'
						? 'bg-green-500/20 text-green-400'
						: data.selectedSet?.play_state === 'recap'
							? 'bg-indigo-500/20 text-indigo-400'
							: 'bg-amber-500/20 text-amber-400'}"
				>
					{data.selectedSet?.play_state}
				</span>
			</div>
		{/if}

		<!-- Three-panel layout -->
		<div class="grid gap-5 md:grid-cols-3">
			<!-- Panel 1: Teams -->
			<div>
				<h2 class="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">Teams</h2>
				<div class="space-y-2">
					{#each teams as team (team.id)}
						{@const tp = teamPlayers(team.id)}
						<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
							<div class="mb-1.5 flex items-center justify-between">
								<div class="flex items-center gap-2">
									<div
										class="h-2.5 w-2.5 rounded-full"
										style="background-color: {teamColorHex[team.color] ?? '#666'}"
									></div>
									<span class="text-sm font-semibold text-zinc-200">{team.display_name}</span>
									<span class="text-xs text-zinc-600">({tp.length})</span>
								</div>
								<span class="text-lg font-black tabular-nums text-white">{team.score}</span>
							</div>
							<!-- Score bar -->
							<div class="mb-2 h-1 w-full rounded-full bg-zinc-800">
								<div
									class="h-1 rounded-full transition-all duration-500"
									style="width: {(team.score / maxScore) * 100}%; background-color: {teamColorHex[team.color] ?? '#666'}"
								></div>
							</div>
							<!-- Players -->
							{#if tp.length > 0}
								<div class="flex flex-wrap gap-1.5">
									{#each tp as p}
										<div class="flex items-center gap-1 text-xs text-zinc-400">
											{#if p.photo_url}
												<img
													src={p.photo_url}
													alt={p.display_name}
													class="h-5 w-5 rounded-full object-cover"
												/>
											{:else}
												<div
													class="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[9px] font-bold text-zinc-400"
												>
													{p.display_name.charAt(0).toUpperCase()}
												</div>
											{/if}
											<span>{p.display_name}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-xs text-zinc-700">No players</p>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<!-- Panel 2: Challenge progress -->
			<div>
				<h2 class="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
					Challenges ({data.challenges.length})
				</h2>
				{#if data.challenges.length === 0}
					<div
						class="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center text-sm text-zinc-600"
					>
						No challenges in this set.
					</div>
				{:else}
					<div class="space-y-2">
						{#each data.challenges as challenge (challenge.id)}
							<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
								<div class="mb-2">
									<div class="text-sm font-semibold leading-tight text-white">
										{challenge.title}
									</div>
									<div class="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
										<span class="rounded bg-zinc-800 px-1 py-0.5">{challenge.variant}</span>
										{#if challenge.timer_seconds > 0}
											<span>{challenge.timer_seconds}s</span>
										{/if}
										<span
											class="rounded px-1 py-0.5 {challenge.status === 'active'
												? 'bg-green-900/50 text-green-400'
												: 'text-zinc-600'}"
										>
											{challenge.status}
										</span>
									</div>
								</div>
								<!-- Per-team grid -->
								<div class="space-y-0.5">
									{#each teams as team}
										{@const cell = cellStatus(challenge.id, team.id, now)}
										<div
											class="flex items-center justify-between rounded px-2 py-1 text-xs even:bg-zinc-800/30"
										>
											<div class="flex items-center gap-1.5">
												<div
													class="h-1.5 w-1.5 rounded-full"
													style="background-color: {teamColorHex[team.color] ?? '#666'}"
												></div>
												<span class="text-zinc-400">{team.display_name}</span>
											</div>
											<div class="flex items-center gap-1">
												<span class="tabular-nums {cell.color}">{cell.label}</span>
												{#if cell.hasAttempt}
													<form method="POST" action="?/resetTeamAttempt" use:enhance>
														<input type="hidden" name="challenge_id" value={challenge.id} />
														<input type="hidden" name="team_id" value={team.id} />
														<button
															type="submit"
															onclick={(e) => {
																if (
																	!confirm(
																		`Reset ${team.display_name}'s attempt? This will delete their submission and deduct points.`
																	)
																)
																	e.preventDefault();
															}}
															title="Reset attempt"
															class="text-zinc-600 transition-colors hover:text-red-400"
														>↺</button>
													</form>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Panel 3: Leaderboard -->
			<div>
				<h2 class="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
					Leaderboard
				</h2>
				<div class="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
					{#each sortedByScore as team, i (team.id)}
						<div
							class="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 last:border-0"
						>
							<span class="w-5 text-center text-sm font-black text-zinc-500">#{i + 1}</span>
							<div
								class="h-2.5 w-2.5 shrink-0 rounded-full"
								style="background-color: {teamColorHex[team.color] ?? '#666'}"
							></div>
							<span class="flex-1 truncate text-sm text-zinc-200">{team.display_name}</span>
							<span class="text-xl font-black tabular-nums text-white">{team.score}</span>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Activity ticker -->
		<div class="mt-6">
			<h2 class="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">Activity</h2>
			<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
				{#if activity.length === 0}
					<p class="py-4 text-center text-sm text-zinc-600">No activity yet.</p>
				{:else}
					<div class="max-h-48 space-y-2 overflow-y-auto">
						{#each activity as a (a.id)}
							<div class="border-b border-zinc-800 pb-2 text-xs last:border-0">
								<div class="flex items-center justify-between gap-2">
									<span class="text-zinc-300">{activityLabel(a)}</span>
									<span class="shrink-0 text-zinc-600">{fmtTime(a.created_at)}</span>
								</div>
								{#if a.team_id}
									<span class="text-zinc-500">{teamLabel(a.team_id)}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
