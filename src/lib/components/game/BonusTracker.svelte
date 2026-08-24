<script lang="ts">
	import type { ScoreBreakdown } from '$lib/types/index.js';

	let {
		breakdown,
		teamColor: _teamColor = '#ef4444'
	}: { breakdown: ScoreBreakdown; teamColor?: string } = $props();

	const diffPct = $derived(Math.round(breakdown.difficulty_multiplier * 100));
	// Only a positive difficulty delta (hard challenge) is shown. Neutral (1.0) and
	// the now-impossible penalty case (<1.0) render no badge.
	const hasDifficulty = $derived(breakdown.difficulty_multiplier > 1);
	const hasRound = $derived(breakdown.round_multiplier > 1);
	const hasComeback = $derived(breakdown.comeback_multiplier > 1);
	const hasStreak = $derived(breakdown.streak_bonus > 0);
	const hasSpeed = $derived(breakdown.speed_bonus > 0);
	// A Double Down is shown whenever one was live — INCLUDING a lost bet, unlike
	// every other badge here (which only render a positive delta). A team whose
	// points went DOWN is exactly the team owed an explanation.
	const dd = $derived(breakdown.double_down);

	const anyBonus = $derived(
		hasDifficulty || hasRound || hasComeback || hasStreak || hasSpeed || !!dd
	);
</script>

<!--
	Bonus-pillen (redesign fase 3, designscherm 8). De designbron toont één rij
	cyane pillen — "MOEILIJKHEID x1,5", "RONDE x2", "STREAK +20", "SNELHEID +15".
	Alleen de vormgeving is nieuw: welke pil verschijnt en met welke waarde komt
	onveranderd uit `breakdown`.
-->
{#if anyBonus}
	<div class="flex flex-wrap gap-1.5">
		{#if hasDifficulty}
			<span class="mixup-pill">Moeilijkheid +{diffPct - 100}%</span>
		{/if}
		{#if hasRound}
			<span class="mixup-pill">Ronde x{breakdown.round_multiplier}</span>
		{/if}
		{#if hasComeback}
			<span class="mixup-pill">Comeback x1,5</span>
		{/if}
		{#if hasStreak}
			<span class="mixup-pill">🔥 Streak +{breakdown.streak_bonus}</span>
		{/if}
		{#if hasSpeed}
			<span class="mixup-pill">⚡ Snelheid +{breakdown.speed_bonus}</span>
		{/if}
		{#if dd}
			<!-- Ook een VERLOREN Double Down krijgt een pil, anders dan elke andere
			     badge hier: een team waarvan de punten omlaag gingen is precies het
			     team dat uitleg verdient. Magenta i.p.v. cyaan bij een miss. -->
			<span class="mixup-pill" class:mixup-pill--miss={!dd.hit}>
				🎰 Double Down {dd.predicted_pct}% / {dd.score_pct}% — {dd.hit ? 'raak' : 'mis'} x{dd.multiplier}
			</span>
		{/if}
	</div>
{/if}

<style>
	/* bonusPillStyle uit de designbron. */
	.mixup-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border-radius: 999px;
		padding: 6px 11px;
		background: rgba(0, 229, 255, 0.07);
		border: 1px solid rgba(0, 229, 255, 0.35);
		color: #6fe8ff;
	}
	.mixup-pill--miss {
		background: rgba(255, 45, 170, 0.08);
		border-color: rgba(255, 45, 170, 0.4);
		color: #ff8ed0;
	}
</style>
