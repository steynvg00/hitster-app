<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData } from './$types';
	import type { TeamRow, ActivityLogRow } from '$lib/types/database';

	let { data }: { data: PageData } = $props();

	type ActiveChallenge = (typeof data.activeChallenges)[number];

	let teams = $state<TeamRow[]>(untrack(() => data.teams));
	let activity = $state<ActivityLogRow[]>(untrack(() => data.recentActivity));
	let activeChallenges = $state<ActiveChallenge[]>(untrack(() => data.activeChallenges));

	// Sync activeChallenges when data updates after form actions
	$effect(() => {
		activeChallenges = data.activeChallenges;
	});

	const teamColorHex: Record<string, string> = {
		blue: '#3b82f6', yellow: '#eab308', green: '#22c55e',
		red: '#ef4444', indigo: '#6366f1', black: '#64748b'
	};

	function teamLabel(id: string) {
		return teams.find((t) => t.id === id)?.display_name ?? id.slice(0, 8);
	}

	function fmtTime(iso: string) {
		const d = new Date(iso);
		return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function fmtMs(ms: number): string {
		const s = Math.ceil(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	function activityLabel(a: ActivityLogRow): string {
		const base = a.event_type.replace(/_/g, ' ');
		const payload = a.payload as Record<string, unknown> | null;
		if (a.event_type === 'score_adjustment' && payload) {
			const delta = Number(payload.delta ?? 0);
			const sign = delta >= 0 ? '+' : '';
			return `Score adjustment (${sign}${delta}): ${payload.reason ?? ''}`;
		}
		if (a.event_type === 'challenge_closed') return `Challenge closed`;
		if (a.event_type === 'attempt_reset') return `Attempt reset`;
		return base;
	}

	// ── Polling state ─────────────────────────────────────────────────────────
	let pollingActive = $state(false);
	let lastPolledAt = $state<Date | null>(null);

	// ── Live clock (for per-attempt timer display) ─────────────────────────────
	let now = $state(Date.now());

	function attemptStatus(
		challenge: ActiveChallenge,
		teamId: string,
		nowMs: number
	): { label: string; color: string; hasAttempt: boolean } {
		const attempt = challenge.attempts.find((a) => a.team_id === teamId);
		const submitted = challenge.submittedTeamIds.includes(teamId);

		if (!attempt) return { label: 'Not started', color: 'text-zinc-600', hasAttempt: false };

		if (submitted || attempt.ended_at) {
			return { label: 'Submitted', color: 'text-green-400', hasAttempt: true };
		}

		if (challenge.timer_seconds > 0) {
			const endsAt = new Date(attempt.started_at).getTime() + challenge.timer_seconds * 1000;
			const remaining = endsAt - nowMs;
			if (remaining <= 0) {
				return { label: 'Expired — pending auto-submit', color: 'text-amber-400', hasAttempt: true };
			}
			const color = remaining < 30_000 ? 'text-red-400' : remaining < 60_000 ? 'text-yellow-400' : 'text-blue-400';
			return { label: `In progress — ${fmtMs(remaining)}`, color, hasAttempt: true };
		}

		return { label: 'In progress', color: 'text-blue-400', hasAttempt: true };
	}

	onMount(() => {
		const clockIv = setInterval(() => { now = Date.now(); }, 1000);

		// Poll every 10s: close expired attempts + sweep expired player sessions
		const autoSubmitInterval = setInterval(async () => {
			pollingActive = true;
			try {
				await Promise.all([
					fetch('/api/auto-submit', { method: 'POST' }),
					fetch('/api/player/sweep', { method: 'POST' })
				]);
			} catch { /* swallow network errors */ }
			pollingActive = false;
			lastPolledAt = new Date();
		}, 10_000);

		const teamSub = supabaseBrowser
			.channel('live-teams')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
				supabaseBrowser.from('teams').select('*').order('score', { ascending: false })
					.then(({ data: fresh }) => { if (fresh) teams = fresh; });
			})
			.subscribe();

		const actSub = supabaseBrowser
			.channel('live-activity')
			.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, (payload) => {
				activity = [payload.new as ActivityLogRow, ...activity].slice(0, 30);
			})
			.subscribe();

		const subSub = supabaseBrowser
			.channel('live-submissions')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => {
				window.location.reload();
			})
			.subscribe();

		const attemptSub = supabaseBrowser
			.channel('live-attempts')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'challenge_attempts' }, () => {
				window.location.reload();
			})
			.subscribe();

		return () => {
			clearInterval(clockIv);
			clearInterval(autoSubmitInterval);
			supabaseBrowser.removeChannel(teamSub);
			supabaseBrowser.removeChannel(actSub);
			supabaseBrowser.removeChannel(subSub);
			supabaseBrowser.removeChannel(attemptSub);
		};
	});

	const sortedTeams = $derived([...teams].sort((a, b) => b.score - a.score));
	const maxScore = $derived(Math.max(...teams.map((t) => t.score), 1));
</script>

<div class="p-6">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white">Live Console</h1>
			<p class="text-zinc-400 text-sm mt-0.5">Realtime game state</p>
		</div>
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
				<span class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
				Live
			</div>
		</div>
	</div>

	<div class="grid grid-cols-3 gap-5">
		<!-- Left: Scores -->
		<div class="col-span-1">
			<h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Scores</h2>
			<div class="space-y-2">
				{#each sortedTeams as team (team.id)}
					<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
						<div class="flex items-center justify-between mb-1">
							<div class="flex items-center gap-2">
								<div class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {teamColorHex[team.color] ?? '#666'}"></div>
								<span class="text-sm text-zinc-300">{team.display_name}</span>
							</div>
							<span class="text-xl font-black text-white tabular-nums">{team.score}</span>
						</div>
						<div class="w-full bg-zinc-800 rounded-full h-1.5">
							<div
								class="h-1.5 rounded-full transition-all duration-500"
								style="width: {(team.score / maxScore) * 100}%; background-color: {teamColorHex[team.color] ?? '#666'}"
							></div>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Middle: Active challenges with per-team attempt status -->
		<div class="col-span-1">
			<h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Active Challenges ({activeChallenges.length})</h2>
			{#if activeChallenges.length === 0}
				<div class="bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-center text-zinc-600 text-sm">
					No active challenges.<br/>Publish a challenge from the Challenges tab.
				</div>
			{:else}
				<div class="space-y-3">
					{#each activeChallenges as challenge (challenge.id)}
						<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
							<div class="flex items-start justify-between mb-3">
								<div class="min-w-0 flex-1">
									<div class="font-semibold text-white">{challenge.title}</div>
									<div class="text-xs text-zinc-500 mt-0.5">
										{challenge.variant}
										{#if challenge.stage_label} · {challenge.stage_label}{/if}
										{#if challenge.timer_seconds > 0} · {challenge.timer_seconds}s timer{/if}
									</div>
								</div>
								<form method="POST" action="?/closeChallenge" use:enhance class="ml-2 shrink-0">
									<input type="hidden" name="id" value={challenge.id} />
									<button
										type="submit"
										onclick={(e) => { if (!confirm('Force-close this challenge for everyone?')) e.preventDefault(); }}
										class="text-xs border border-red-800 text-red-400 hover:bg-red-950 px-2 py-1 rounded-lg transition-colors"
									>
										Close
									</button>
								</form>
							</div>

							<!-- Per-team attempt status -->
							<div class="space-y-1">
								{#each teams as team}
									{@const status = attemptStatus(challenge, team.id, now)}
									<div class="flex items-center justify-between text-xs rounded px-2 py-1.5 bg-zinc-800">
										<div class="flex items-center gap-1.5 min-w-0">
											<div
												class="w-1.5 h-1.5 rounded-full shrink-0"
												style="background-color: {teamColorHex[team.color] ?? '#666'}"
											></div>
											<span class="text-zinc-300 truncate">{team.display_name}</span>
										</div>
										<div class="flex items-center gap-1.5 ml-2 shrink-0">
											<span class="tabular-nums {status.color}">{status.label}</span>
											{#if status.hasAttempt}
												<form method="POST" action="?/resetTeamAttempt" use:enhance>
													<input type="hidden" name="challenge_id" value={challenge.id} />
													<input type="hidden" name="team_id" value={team.id} />
													<button
														type="submit"
														onclick={(e) => { if (!confirm(`Reset ${team.display_name}'s attempt? This will delete their submission and deduct points.`)) e.preventDefault(); }}
														class="text-zinc-600 hover:text-red-400 px-1 transition-colors"
														title="Reset attempt"
													>
														↺
													</button>
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

		<!-- Right: Activity ticker -->
		<div class="col-span-1">
			<h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">Activity</h2>
			<div class="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2 max-h-[70vh] overflow-y-auto">
				{#if activity.length === 0}
					<p class="text-zinc-600 text-sm text-center py-4">No activity yet.</p>
				{:else}
					{#each activity as a (a.id)}
						<div class="text-xs border-b border-zinc-800 pb-2 last:border-0">
							<div class="flex items-center justify-between gap-2">
								<span class="text-zinc-300">{activityLabel(a)}</span>
								<span class="text-zinc-600 shrink-0">{fmtTime(a.created_at)}</span>
							</div>
							{#if a.team_id}
								<span class="text-zinc-500">{teamLabel(a.team_id)}</span>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>
