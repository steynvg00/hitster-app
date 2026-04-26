<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const teamColors: Record<string, { bg: string; border: string; text: string }> = {
		blue: { bg: '#3b82f6', border: '#2563eb', text: '#fff' },
		yellow: { bg: '#eab308', border: '#ca8a04', text: '#000' },
		green: { bg: '#22c55e', border: '#16a34a', text: '#000' },
		red: { bg: '#ef4444', border: '#dc2626', text: '#fff' },
		indigo: { bg: '#6366f1', border: '#4f46e5', text: '#fff' },
		black: { bg: '#1e293b', border: '#0f172a', text: '#fff' }
	};

	const c = $derived(teamColors[data.team.color] ?? { bg: '#6b7280', border: '#4b5563', text: '#fff' });

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
</script>

<!-- Team banner -->
<div
	class="px-6 py-8"
	style="background-color: {c.bg}; border-bottom: 3px solid {c.border};"
>
	<div class="mx-auto max-w-lg">
		<div class="text-sm font-bold uppercase tracking-widest" style="color: {c.text}; opacity: 0.7;">
			You are
		</div>
		<h1 class="mt-1 text-4xl font-black" style="color: {c.text};">
			{data.team.label}
		</h1>
	</div>
</div>

<div class="mx-auto max-w-lg p-6 space-y-6">

	<!-- Score + position -->
	<div class="grid grid-cols-2 gap-4">
		<div class="rounded-2xl bg-zinc-900 p-5 text-center">
			<div class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Score</div>
			<div class="tabular-nums mt-1 text-5xl font-black text-white">{data.team.score}</div>
			<div class="mt-1 text-xs text-zinc-600">points</div>
		</div>
		<div class="rounded-2xl bg-zinc-900 p-5 text-center">
			<div class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Position</div>
			<div class="tabular-nums mt-1 text-5xl font-black" style="color: {c.bg};">
				{ordinal(data.position)}
			</div>
			<div class="mt-1 text-xs text-zinc-600">of {data.totalTeams} teams</div>
		</div>
	</div>

	<!-- Challenges -->
	<div>
		<h2 class="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Challenges</h2>
		{#if data.challenges.length === 0}
			<p class="text-sm text-zinc-600">No active challenges yet — check back soon.</p>
		{:else}
			<div class="space-y-2">
				{#each data.challenges as ch}
					<div class="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
						<div>
							<div class="font-semibold text-zinc-100">{ch.title}</div>
							<div class="text-xs text-zinc-500 capitalize">{ch.variant}</div>
						</div>
						{#if ch.status === 'completed'}
							<div class="text-right">
								<div class="text-xs font-bold text-green-400 uppercase tracking-wide">Done</div>
								<div class="text-sm font-black text-white">+{ch.earnedScore ?? 0} pts</div>
							</div>
						{:else}
							<a
								href="/challenge/{ch.id}"
								class="rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white transition-opacity hover:opacity-80"
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
			<h2 class="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Recent activity</h2>
			<div class="space-y-1.5">
				{#each data.recentActivity as entry}
					<div class="flex items-center gap-2 rounded-lg bg-zinc-900/60 px-3 py-2 text-sm">
						<div class="h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {c.bg};"></div>
						<span class="text-zinc-300">
							{formatActivity(entry.event_type, entry.payload)}
						</span>
						<span class="ml-auto text-xs text-zinc-600 tabular-nums">
							{new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Nav -->
	<div class="flex gap-3 pt-2 text-sm">
		<a href="/leaderboard" class="text-zinc-400 underline underline-offset-2">Leaderboard</a>
	</div>

</div>
