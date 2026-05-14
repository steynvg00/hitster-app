<script lang="ts">
	import type { ScoreBreakdown } from '$lib/types/index.js';

	let {
		breakdown,
		teamColor: _teamColor = '#ef4444'
	}: { breakdown: ScoreBreakdown; teamColor?: string } = $props();

	const diffPct = $derived(Math.round(breakdown.difficulty_multiplier * 100));
	const hasDifficulty = $derived(breakdown.difficulty_multiplier !== 1);
	const hasRound = $derived(breakdown.round_multiplier > 1);
	const hasComeback = $derived(breakdown.comeback_multiplier > 1);
	const hasStreak = $derived(breakdown.streak_bonus > 0);
	const hasSpeed = $derived(breakdown.speed_bonus > 0);

	const anyBonus = $derived(hasDifficulty || hasRound || hasComeback || hasStreak || hasSpeed);
</script>

{#if anyBonus}
	<div class="my-3 flex flex-wrap gap-2">
		{#if hasDifficulty}
			<div
				class="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold"
			>
				<span class="text-amber-400">★</span>
				<span class="text-zinc-300">Difficulty {diffPct < 100 ? 'penalty' : 'bonus'}</span>
				<span style="color: {diffPct >= 100 ? '#4ade80' : '#f87171'}">
					{diffPct < 100 ? '' : '+'}{diffPct - 100}%
				</span>
			</div>
		{/if}

		{#if hasRound}
			<div
				class="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold"
			>
				<span class="text-purple-400">×</span>
				<span class="text-zinc-300">Round multiplier</span>
				<span class="text-green-400">{breakdown.round_multiplier}×</span>
			</div>
		{/if}

		{#if hasComeback}
			<div
				class="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold"
			>
				<span>🔥</span>
				<span class="text-zinc-300">Comeback</span>
				<span class="text-green-400">×1.5</span>
			</div>
		{/if}

		{#if hasStreak}
			<div
				class="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold"
			>
				<span class="text-orange-400">🔥</span>
				<span class="text-zinc-300">Streak bonus</span>
				<span class="text-green-400">+{breakdown.streak_bonus}</span>
			</div>
		{/if}

		{#if hasSpeed}
			<div
				class="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold"
			>
				<span class="text-cyan-400">⚡</span>
				<span class="text-zinc-300">Speed bonus</span>
				<span class="text-green-400">+{breakdown.speed_bonus}</span>
			</div>
		{/if}
	</div>
{/if}

{#if breakdown.base !== breakdown.final}
	<div class="mb-1 flex items-center gap-2 text-xs text-zinc-500">
		<span>{breakdown.base} base</span>
		<span>→</span>
		<span class="text-sm font-bold text-white">{breakdown.final} final</span>
	</div>
{/if}
