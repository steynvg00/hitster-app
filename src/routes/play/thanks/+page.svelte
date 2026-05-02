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
</script>

<!-- Team color header -->
<div class="px-6 py-10 text-center" style="background-color: {c.bg}; border-bottom: 3px solid {c.border};">
	<div class="text-sm font-bold uppercase tracking-widest mb-2" style="color: {c.text}; opacity: 0.7;">
		Thanks for playing!
	</div>
	{#if data.playerName}
		<h1 class="text-3xl font-black" style="color: {c.text};">{data.playerName}</h1>
	{/if}
	<div class="mt-2 text-lg font-semibold" style="color: {c.text}; opacity: 0.85;">
		{data.team.display_name}
	</div>
	<div class="mt-1 text-sm" style="color: {c.text}; opacity: 0.6;">{data.setName}</div>
</div>

<div class="mx-auto max-w-lg p-6 space-y-6">
	<!-- Total score card -->
	<div class="rounded-2xl border p-6 text-center" style="border-color: {c.bg}40; background-color: {c.bg}18;">
		<div class="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Total score</div>
		<div class="tabular-nums text-6xl font-black text-white">{data.totalScore}</div>
		<div class="mt-1 text-sm text-zinc-500">points this set</div>
	</div>

	<!-- Per-challenge breakdown -->
	{#if data.challengeResults.length > 0}
		<div>
			<h2 class="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Challenges</h2>
			<div class="space-y-2">
				{#each data.challengeResults as ch}
					<div class="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
						<div>
							<div class="font-semibold text-zinc-100">{ch.title}</div>
							<div class="text-xs text-zinc-500 capitalize">{ch.variant}</div>
						</div>
						<div class="text-right">
							{#if ch.score !== null}
								<div class="text-sm font-black text-white">+{ch.score} pts</div>
							{:else}
								<div class="text-xs text-zinc-600">—</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Play again -->
	<div class="pt-4 text-center">
		<a href="/"
			class="inline-block rounded-xl px-8 py-3 text-base font-bold text-white transition-colors hover:opacity-90"
			style="background-color: {c.bg};">
			Play again
		</a>
	</div>
</div>
