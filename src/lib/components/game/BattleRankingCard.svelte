<script lang="ts">
	// Battle ranking card (Battle Mode stuk 3c) — the shared reveal surface for a
	// single resolved battle. Rendered on BOTH the player waiting page (with the
	// player's own team highlighted) and the TV podium (no highlight), so the two
	// can never drift apart visually.
	//
	// PURE DISPLAY over stored data: `ranking` is set_challenges.battle_ranking
	// exactly as resolveBattle recorded it — already ordered best→worst, with
	// `rank` already assigned (competition numbering, so a tied block SHARES its
	// number and two teams can both read "2nd"). Never re-rank or re-sort here;
	// the stored order and numbers are the source of truth.
	//
	// Shows rank + team + awarded ladder points only. raw_score and
	// elapsed_seconds are deliberately NOT shown: raw_score is the pre-multiplier
	// ranking key and reads as a wrong score next to the leaderboard.

	type BattleRankRow = {
		team_id: string;
		rank: number;
		awarded: number;
	};
	type TeamInfo = { id: string; color: string; display_name: string };

	let {
		title,
		ranking,
		teams,
		highlightTeamId = null,
		compact = false
	}: {
		title: string;
		ranking: BattleRankRow[];
		teams: TeamInfo[];
		/** Player surface passes their own team id; the TV passes nothing. */
		highlightTeamId?: string | null;
		/** Denser type for the phone card. */
		compact?: boolean;
	} = $props();

	const teamColors: Record<string, { bg: string; border: string; text: string }> = {
		blue: { bg: '#3b82f6', border: '#2563eb', text: '#fff' },
		yellow: { bg: '#eab308', border: '#ca8a04', text: '#000' },
		green: { bg: '#22c55e', border: '#16a34a', text: '#000' },
		red: { bg: '#ef4444', border: '#dc2626', text: '#fff' },
		indigo: { bg: '#6366f1', border: '#4f46e5', text: '#fff' },
		black: { bg: '#1e293b', border: '#0f172a', text: '#fff' }
	};

	const teamById = $derived(new Map(teams.map((t) => [t.id, t])));

	const ordinal = (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	};
</script>

<div
	class="battle-card overflow-hidden rounded-2xl border border-white/10"
	style="background: rgba(11,11,31,0.72); backdrop-filter: blur(8px);"
>
	<!-- Header: ⚔️ framing + the challenge this battle was -->
	<div
		class="flex items-center gap-2 border-b border-white/10 px-4 py-3"
		style="background: linear-gradient(90deg, rgba(255,45,170,0.16) 0%, rgba(0,229,255,0.10) 100%);"
	>
		<span class="{compact ? 'text-base' : 'text-lg'} leading-none">⚔️</span>
		<div class="min-w-0 flex-1">
			<div
				class="text-[0.6rem] font-black tracking-[0.22em] uppercase"
				style="color: #ff2daa;"
			>
				Battle
			</div>
			<div class="truncate {compact ? 'text-sm' : 'text-base'} font-bold text-white">
				{title}
			</div>
		</div>
	</div>

	<!-- Ranking rows: stored order (best→worst), stored rank numbers -->
	<div class="divide-y divide-white/5">
		{#each ranking as row (row.team_id)}
			{@const team = teamById.get(row.team_id)}
			{@const tc = teamColors[team?.color ?? ''] ?? {
				bg: '#6b7280',
				border: '#4b5563',
				text: '#fff'
			}}
			{@const isMine = highlightTeamId !== null && row.team_id === highlightTeamId}
			<div
				class="flex items-center gap-3 px-4 {compact ? 'py-2' : 'py-2.5'} transition-colors"
				style={isMine
					? `background: ${tc.bg}22; box-shadow: inset 3px 0 0 0 ${tc.bg};`
					: ''}
			>
				<!-- Rank — shared ranks intentionally repeat (two teams can both be 2nd) -->
				<div
					class="w-9 shrink-0 text-center {compact ? 'text-base' : 'text-lg'} font-black tabular-nums"
					style="color: {row.rank === 1 ? '#ffe600' : 'rgba(229,242,255,0.45)'};"
				>
					{ordinal(row.rank)}
				</div>

				<!-- Team -->
				<div class="flex min-w-0 flex-1 items-center gap-2">
					<span
						class="h-2.5 w-2.5 shrink-0 rounded-full"
						style="background: {tc.bg};"
					></span>
					<span
						class="truncate {compact ? 'text-sm' : 'text-base'} {isMine
							? 'font-black text-white'
							: 'font-semibold text-white/75'}"
					>
						{team?.display_name ?? 'Unknown team'}
					</span>
					{#if isMine}
						<span
							class="shrink-0 rounded-full px-1.5 py-0.5 text-[0.55rem] font-black tracking-wider uppercase"
							style="background: {tc.bg}; color: {tc.text};"
						>
							You
						</span>
					{/if}
				</div>

				<!-- Ladder points awarded -->
				<div class="shrink-0 text-right">
					<span
						class="{compact ? 'text-sm' : 'text-base'} font-black tabular-nums"
						style="color: {row.awarded > 0 ? '#ffe600' : 'rgba(229,242,255,0.3)'};"
					>
						{row.awarded > 0 ? `+${row.awarded}` : '0'}
					</span>
					<span class="ml-0.5 text-[0.6rem] text-white/30">pts</span>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.battle-card {
		animation: battleIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes battleIn {
		from {
			opacity: 0;
			transform: translateY(14px) scale(0.97);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.battle-card {
			animation: none;
		}
	}
</style>
