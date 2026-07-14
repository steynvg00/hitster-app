<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const gs = $derived(data.gameSet);

	// Track reveal state via realtime
	let revealIndex = $state(untrack(() => gs.recap_reveal_index ?? 0));
	let ranking = $state<string[]>(untrack(() => (gs.recap_ranking as string[]) ?? []));
	let recapState = $state(untrack(() => gs.recap_state));
	// Battle reveal counter (stuk 3b) — SEPARATE from revealIndex on purpose:
	// revealIndex is "teams revealed" and indexes straight into `ranking`.
	let battleRevealIndex = $state(untrack(() => gs.battle_reveal_index ?? 0));

	// Which team was just revealed (for brief highlight)
	let justRevealedId = $state<string | null>(null);
	let revealTimer: ReturnType<typeof setTimeout> | null = null;

	const totalTeams = $derived(data.rankedTeams.length);
	const allRevealed = $derived(revealIndex >= totalTeams);
	const _isPodiumPhase = $derived(
		revealIndex >= totalTeams - Math.min(3, totalTeams) && revealIndex < totalTeams
	);

	// ── Phase (stuk 3b) ────────────────────────────────────────────────────────
	const battlesTotal = $derived(data.battles.length);
	const inBattlePhase = $derived(recapState === 'battle_reveal');
	const battlesDone = $derived(battleRevealIndex >= battlesTotal);
	// While in the battle phase there is always a next click: either the next
	// battle, or the hand-over click that starts the team cascade.
	const canReveal = $derived(inBattlePhase || !allRevealed);

	const nextRevealLabel = $derived(
		inBattlePhase
			? battlesDone
				? 'Start team reveal ›'
				: `Reveal battle ${battleRevealIndex + 1}/${battlesTotal} ›`
			: 'Reveal next ›'
	);

	function isRevealed(teamId: string): boolean {
		if (ranking.length === 0) return false;
		const pos = ranking.indexOf(teamId);
		return pos !== -1 && pos < revealIndex;
	}

	function rankPosition(teamId: string): number {
		// Position from best (1st = highest score = last in ranking array)
		const pos = ranking.indexOf(teamId);
		if (pos === -1) return 0;
		return totalTeams - pos;
	}

	const teamColors: Record<string, { bg: string; text: string }> = {
		blue: { bg: '#1d4ed8', text: '#fff' },
		yellow: { bg: '#ca8a04', text: '#000' },
		green: { bg: '#15803d', text: '#fff' },
		red: { bg: '#b91c1c', text: '#fff' },
		indigo: { bg: '#4338ca', text: '#fff' },
		black: { bg: '#18181b', text: '#fff' }
	};

	const ordinal = (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	};

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`recap-host-${gs.id}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'game_sets',
					filter: `id=eq.${gs.id}`
				},
				(payload) => {
					const updated = payload.new as {
						recap_reveal_index: number;
						recap_ranking: string[];
						recap_state: string;
						battle_reveal_index: number;
					};
					const newIndex = updated.recap_reveal_index ?? revealIndex;
					const newRanking = (updated.recap_ranking as string[]) ?? ranking;

					if (newIndex > revealIndex && newRanking.length > 0) {
						justRevealedId = newRanking[newIndex - 1] ?? null;
						if (revealTimer) clearTimeout(revealTimer);
						revealTimer = setTimeout(() => (justRevealedId = null), 2500);
					}

					ranking = newRanking;
					revealIndex = newIndex;
					recapState = updated.recap_state ?? recapState;
					if (updated.battle_reveal_index !== undefined) {
						battleRevealIndex = updated.battle_reveal_index;
					}
				}
			)
			.subscribe();

		return () => {
			supabaseBrowser.removeChannel(channel);
			if (revealTimer) clearTimeout(revealTimer);
		};
	});
</script>

<svelte:head>
	<title>Recap — {gs.name} — Admin</title>
</svelte:head>

<div class="mx-auto min-h-screen max-w-5xl p-6">
	<!-- Header -->
	<div class="mb-6 flex items-start justify-between gap-4">
		<div>
			<a
				href="/admin/sets/{gs.id}"
				class="text-xs text-zinc-500 transition-colors hover:text-zinc-300">← {gs.name}</a
			>
			<h1 class="mt-1 text-2xl font-black text-white">Recap</h1>
			<!-- Phase indicator (stuk 3b): battles reveal before the team cascade. -->
			{#if inBattlePhase}
				<p class="text-sm text-zinc-500">
					<span class="font-semibold text-amber-400">Battles</span>
					— {battleRevealIndex}/{battlesTotal} revealed · teams next
				</p>
			{:else}
				<p class="text-sm text-zinc-500">
					{#if battlesTotal > 0}
						<span class="text-zinc-600">Battles done ·</span>
					{/if}
					{revealIndex}/{totalTeams} teams revealed
				</p>
			{/if}
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<!-- Reveal drives BOTH phases; the same action decides which advances.
			     End & Reset must stay reachable once recap_state is 'complete'
			     (which the final team reveal now actually writes), so it is gated
			     on the cascade being done — not on the state string. -->
			{#if canReveal}
				<form
					method="POST"
					action="?/reveal"
					use:enhance={({ cancel: _cancel }) => {
						return async ({ update }) => {
							await update({ reset: false });
						};
					}}
				>
					<button
						type="submit"
						class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
					>
						{nextRevealLabel}
					</button>
				</form>
			{:else}
				{#if recapState === 'complete'}
					<span class="rounded-full bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400">Set complete</span>
				{/if}
				<form
					method="POST"
					action="?/endAndReset"
					use:enhance
					onsubmit={(e) => {
						if (!confirm('End set and clear all player assignments?')) e.preventDefault();
					}}
				>
					<button
						type="submit"
						class="rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-green-600"
					>
						End & Reset
					</button>
				</form>
			{/if}

			<!-- TV podium link -->
			<a
				href="/sets/{gs.id}/podium"
				target="_blank"
				class="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:text-white"
			>
				TV Podium ↗
			</a>

			<!-- Reset game (always visible in recap) -->
			<form
				method="POST"
				action="?/resetGame"
				use:enhance
				onsubmit={(e) => {
					if (
						!confirm(
							'Reset this game? Player sessions, scores, and submissions will be cleared. Last results will be preserved.'
						)
					)
						e.preventDefault();
				}}
			>
				<button
					type="submit"
					class="rounded-lg border border-red-800/60 px-4 py-2 text-sm font-semibold text-red-400 transition-colors hover:border-red-700 hover:text-red-300"
				>
					Reset game
				</button>
			</form>
		</div>
	</div>

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}

	<!-- Battle reveal strip (stuk 3b, host-only). The player waiting card and the
	     TV podium battle panel are stuk 3c — this pass is the machinery. -->
	{#if battlesTotal > 0}
		<div class="mb-8">
			<h2 class="mb-3 text-xs font-semibold tracking-widest text-zinc-400 uppercase">
				Battles — revealed before the team podium
			</h2>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
				{#each data.battles as battle, i}
					{@const revealed = i < battleRevealIndex}
					{@const isNext = inBattlePhase && i === battleRevealIndex}
					<div
						class="rounded-xl border px-3 py-2.5 transition-all duration-500
						{revealed ? 'border-amber-400/40 bg-amber-950/20' : 'border-zinc-800 bg-zinc-900'}
						{isNext ? 'ring-1 ring-amber-400/60' : ''}"
					>
						<div class="flex items-center gap-1.5">
							<span class="text-xs">⚔️</span>
							<span class="truncate text-xs font-semibold {revealed ? 'text-amber-300' : 'text-zinc-500'}">
								{battle.title}
							</span>
						</div>
						<div class="mt-1 text-xs {revealed ? 'text-amber-400/70' : 'text-zinc-600'}">
							{revealed ? 'Revealed' : isNext ? 'Next up' : `Battle ${i + 1}`}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Highlight Reel: fastest correct submission per challenge -->
	{#if data.fastestAnswers.length > 0}
		{@const teamColorHex: Record<string, string> = {
			blue: '#3b82f6',
			yellow: '#eab308',
			green: '#22c55e',
			red: '#ef4444',
			indigo: '#6366f1',
			black: '#64748b'
		}}
		<div class="mb-8">
			<h2 class="mb-3 text-xs font-semibold tracking-widest text-zinc-400 uppercase">
				Highlight Reel — fastest answers
			</h2>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
				{#each data.fastestAnswers as fa}
					<div class="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
						<div class="mb-1 truncate text-xs font-semibold text-zinc-300">{fa.challenge_name}</div>
						<div class="flex items-center gap-1.5">
							<div
								class="h-2 w-2 shrink-0 rounded-full"
								style="background-color: {teamColorHex[fa.team_color] ?? '#52525b'};"
							></div>
							<span class="truncate text-xs text-zinc-400">{fa.team_display_name}</span>
						</div>
						<div
							class="mt-1 text-sm font-black tabular-nums"
							style="color: {teamColorHex[fa.team_color] ?? '#52525b'};"
						>
							{fa.elapsed_seconds < 60
								? `${fa.elapsed_seconds.toFixed(1)}s`
								: `${Math.floor(fa.elapsed_seconds / 60)}m ${(fa.elapsed_seconds % 60).toFixed(0)}s`}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Non-podium teams (4th place and below) — flat grid, last-first order -->
	{#if totalTeams > 3}
		<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
			{#each data.rankedTeams.slice(0, totalTeams - 3) as team, i}
				{@const revealed = isRevealed(team.id)}
				{@const justRevealed = justRevealedId === team.id}
				{@const pos = revealed ? rankPosition(team.id) : null}
				{@const tc = teamColors[team.color] ?? { bg: '#27272a', text: '#fff' }}
				{@const _teamPlayers = data.playersByTeam[team.id] ?? []}
				<div
					class="overflow-hidden rounded-2xl border transition-all duration-700
					{revealed ? 'border-transparent' : 'border-zinc-700'}
					{justRevealed ? 'scale-105 shadow-lg ring-2 shadow-amber-400/20 ring-amber-400' : ''}"
				>
					{#if revealed}
						<div class="p-4 text-center" style="background-color: {tc.bg}; color: {tc.text};">
							<div class="mb-0.5 text-3xl font-black tabular-nums">{ordinal(pos!)}</div>
							<div class="text-base font-bold">{team.display_name}</div>
							<div class="mt-1 text-xl font-black tabular-nums opacity-90">{team.setScore}</div>
							<div class="text-xs opacity-60">pts</div>
						</div>
					{:else}
						<div class="flex h-32 items-center justify-center bg-zinc-900">
							<div class="text-center">
								<div class="text-3xl font-black text-zinc-700">?</div>
								<div class="mt-1 text-xs text-zinc-700">#{i + 1} to reveal</div>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Olympic podium — 2nd left · 1st centre · 3rd right -->
	{#if totalTeams >= 2}
		{@const podiumSlots = [
			{ pos: 2, team: data.rankedTeams[totalTeams - 2], revealOrder: 2 },
			{ pos: 1, team: data.rankedTeams[totalTeams - 1], revealOrder: 1 },
			...(totalTeams >= 3
				? [{ pos: 3, team: data.rankedTeams[totalTeams - 3], revealOrder: 3 }]
				: [])
		]}
		<div class="grid gap-4 {totalTeams >= 3 ? 'grid-cols-3' : 'grid-cols-2'}">
			{#each podiumSlots as slot}
				{@const revealed = isRevealed(slot.team.id)}
				{@const justRevealed = justRevealedId === slot.team.id}
				{@const pos = revealed ? rankPosition(slot.team.id) : null}
				{@const tc = teamColors[slot.team.color] ?? { bg: '#27272a', text: '#fff' }}
				{@const teamPlayers = data.playersByTeam[slot.team.id] ?? []}
				<div
					class="overflow-hidden rounded-2xl border transition-all duration-700
					{revealed ? 'border-transparent' : 'border-zinc-700'}
					{justRevealed ? 'scale-105 shadow-lg ring-2 shadow-amber-400/20 ring-amber-400' : ''}
					{slot.pos === 1 ? 'ring-1 ring-amber-400/30' : ''}"
				>
					{#if revealed}
						<div class="p-5 text-center" style="background-color: {tc.bg}; color: {tc.text};">
							<div class="mb-1 text-4xl font-black tabular-nums">{ordinal(pos!)}</div>
							<div class="text-lg font-bold">{slot.team.display_name}</div>
							<div class="mt-1 text-2xl font-black tabular-nums opacity-90">
								{slot.team.setScore}
							</div>
							<div class="text-xs opacity-60">pts</div>
							{#if teamPlayers.length > 0}
								<div class="mt-3 flex flex-wrap justify-center gap-1">
									{#each teamPlayers as p}
										<div
											class="flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-xs"
										>
											{#if p.photo_url}
												<img
													src={p.photo_url}
													alt={p.display_name}
													class="h-4 w-4 rounded-full object-cover"
												/>
											{/if}
											<span>{p.display_name}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<div class="flex h-40 items-center justify-center bg-zinc-900">
							<div class="text-center">
								<div class="text-4xl font-black text-zinc-700">?</div>
								<div class="mt-1 text-xs text-zinc-700">
									{slot.pos === 1 ? '🏆' : slot.pos === 2 ? '🥈' : '🥉'} podium
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Gated on the cascade, not on recap_state: the final reveal now writes
	     'complete', which would otherwise hide this banner exactly when it is
	     most relevant. -->
	{#if allRevealed && !inBattlePhase}
		<div class="mt-8 rounded-xl border border-green-800 bg-green-950/30 p-6 text-center">
			<p class="mb-1 text-lg font-bold text-green-400">All teams revealed!</p>
			<p class="text-sm text-zinc-400">
				Players have been sent to their thanks screen. Click "End & Reset" to finish the set.
			</p>
		</div>
	{/if}
</div>
