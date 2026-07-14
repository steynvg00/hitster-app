<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import BattleRankingCard from '$lib/components/game/BattleRankingCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const gs = $derived(data.gameSet);

	let revealIndex = $state(untrack(() => gs.recap_reveal_index ?? 0));
	let ranking = $state<string[]>(untrack(() => (gs.recap_ranking as string[]) ?? []));
	let recapState = $state(untrack(() => (gs.recap_state as string) ?? 'pending'));

	const totalTeams = $derived(data.rankedTeams.length);
	const allRevealed = $derived(totalTeams > 0 && revealIndex >= totalTeams);
	const phase = $derived<'pending' | 'revealing' | 'complete'>(
		recapState === 'complete' || allRevealed
			? 'complete'
			: revealIndex === 0
				? 'pending'
				: 'revealing'
	);

	// ── Battle reveal (stuk 3c) ───────────────────────────────────────────────
	// Layered IN FRONT of `phase` rather than folded into it: during battle_reveal
	// revealIndex is still 0, so `phase` reads 'pending' — the battle panel simply
	// takes the screen ahead of the Stand-by state, and every existing pedestal
	// path below is left exactly as it was.
	let battleRevealIndex = $state(untrack(() => gs.battle_reveal_index ?? 0));
	const inBattlePhase = $derived(recapState === 'battle_reveal');
	// data.battles is position-ordered; newest first so the just-revealed leads.
	const revealedBattles = $derived(data.battles.slice(0, battleRevealIndex).reverse());

	function isRevealed(teamId: string): boolean {
		if (ranking.length === 0) return false;
		const pos = ranking.indexOf(teamId);
		return pos !== -1 && pos < revealIndex;
	}

	function rankPosition(teamId: string): number {
		const pos = ranking.indexOf(teamId);
		if (pos === -1) return 0;
		return totalTeams - pos;
	}

	let animatingTeamId = $state<string | null>(null);
	let animTimer: ReturnType<typeof setTimeout> | null = null;

	const teamColors: Record<string, { bg: string; border: string; text: string }> = {
		blue: { bg: '#1d4ed8', border: '#3b82f6', text: '#fff' },
		yellow: { bg: '#ca8a04', border: '#eab308', text: '#000' },
		green: { bg: '#15803d', border: '#22c55e', text: '#fff' },
		red: { bg: '#b91c1c', border: '#ef4444', text: '#fff' },
		indigo: { bg: '#4338ca', border: '#6366f1', text: '#fff' },
		black: { bg: '#18181b', border: '#3f3f46', text: '#fff' }
	};

	// Festival palette glow per podium position
	const festivalAccent: Record<number, { color: string; glow: string }> = {
		1: { color: '#ff2daa', glow: 'rgba(255,45,170,0.65)' },
		2: { color: '#00e5ff', glow: 'rgba(0,229,255,0.55)' },
		3: { color: '#7c4dff', glow: 'rgba(124,77,255,0.55)' }
	};

	const ordinal = (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	};

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`podium-${gs.id}`)
			.on(
				'postgres_changes',
				{ event: 'UPDATE', schema: 'public', table: 'game_sets', filter: `id=eq.${gs.id}` },
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
						animatingTeamId = newRanking[newIndex - 1] ?? null;
						if (animTimer) clearTimeout(animTimer);
						animTimer = setTimeout(() => (animatingTeamId = null), 2000);
					}

					ranking = newRanking;
					revealIndex = newIndex;
					recapState = updated.recap_state ?? recapState;
					// Battle phase (stuk 3c) — same payload, separate counter.
					if (updated.battle_reveal_index !== undefined) {
						battleRevealIndex = updated.battle_reveal_index;
					}
				}
			)
			.subscribe();

		return () => {
			supabaseBrowser.removeChannel(channel);
			if (animTimer) clearTimeout(animTimer);
		};
	});

	const podiumSlots = $derived(
		totalTeams >= 2
			? [
					{ pos: 2, team: data.rankedTeams[totalTeams - 2], pedestalPx: 100 },
					{ pos: 1, team: data.rankedTeams[totalTeams - 1], pedestalPx: 148 },
					...(totalTeams >= 3
						? [{ pos: 3, team: data.rankedTeams[totalTeams - 3], pedestalPx: 68 }]
						: [])
				]
			: []
	);

	const lowerTeams = $derived(
		totalTeams > 3 ? data.rankedTeams.slice(0, totalTeams - 3).filter((t) => isRevealed(t.id)) : []
	);
</script>

<svelte:head>
	<title>{data.setName} — Podium</title>
</svelte:head>

<!-- Night-sky background with festival gradient overlays -->
<div class="fixed inset-0" style="background: #0b0b1f;">
	<div
		class="absolute inset-0"
		style="background:
			radial-gradient(ellipse at 85% 5%, rgba(255,45,170,0.13) 0%, transparent 50%),
			radial-gradient(ellipse at 10% 92%, rgba(0,229,255,0.10) 0%, transparent 50%),
			radial-gradient(ellipse at 50% 50%, rgba(124,77,255,0.04) 0%, transparent 70%);"
	></div>
</div>

<div
	class="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-10"
>
	<!-- Header -->
	<div class="mb-8 text-center md:mb-12">
		<div
			class="wordmark text-[2.8rem] leading-none font-black tracking-tighter uppercase md:text-[4.5rem]"
		>
			MixUp!
		</div>
		<h1
			class="mt-1 leading-none font-black tracking-[0.12em] text-white uppercase"
			style="font-size: clamp(2rem, 6vw, 4.5rem);"
		>
			Podium
		</h1>
		<p class="mt-2 text-xs tracking-[0.25em] text-white/30 uppercase md:text-sm">{data.setName}</p>
	</div>

	<!-- Battle reveal (stuk 3c) — takes the screen before the pedestals appear.
	     No own-team highlight: this is the shared TV. -->
	{#if inBattlePhase}
		<div class="w-full max-w-6xl">
			<p
				class="mb-6 text-center font-black tracking-[0.2em] text-white/50 uppercase"
				style="font-size: clamp(1.2rem, 3vw, 2rem);"
			>
				⚔️ Battle results
			</p>

			{#if revealedBattles.length === 0}
				<div class="text-center">
					<div class="mb-8 flex justify-center gap-4">
						<span class="pulse-dot" style="background: #ff2daa; animation-delay: 0s;"></span>
						<span class="pulse-dot" style="background: #00e5ff; animation-delay: 0.35s;"></span>
						<span class="pulse-dot" style="background: #7c4dff; animation-delay: 0.7s;"></span>
					</div>
					<p class="text-sm tracking-wider text-white/20">The host is about to reveal the battles</p>
				</div>
			{:else}
				<div class="flex flex-wrap items-start justify-center gap-4">
					{#each revealedBattles as battle (battle.challenge_id)}
						<div class="w-full max-w-md min-w-[300px] flex-1">
							<BattleRankingCard
								title={battle.title}
								ranking={battle.ranking}
								teams={data.battleTeams}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		<!-- Pending state -->
	{:else if phase === 'pending'}
		<div class="text-center">
			<div class="mb-8 flex justify-center gap-4">
				<span class="pulse-dot" style="background: #ff2daa; animation-delay: 0s;"></span>
				<span class="pulse-dot" style="background: #00e5ff; animation-delay: 0.35s;"></span>
				<span class="pulse-dot" style="background: #7c4dff; animation-delay: 0.7s;"></span>
			</div>
			<p
				class="font-black tracking-[0.2em] text-white/50 uppercase"
				style="font-size: clamp(1.4rem, 4vw, 2.5rem);"
			>
				Stand by…
			</p>
			<p class="mt-3 text-sm tracking-wider text-white/20">The host is preparing the reveal</p>
		</div>
	{:else}
		<!-- Lower-ranked teams (4th+) — subdued pill strip -->
		{#if lowerTeams.length > 0}
			<div class="mb-8 flex w-full max-w-4xl flex-wrap justify-center gap-2">
				{#each lowerTeams as team}
					{@const pos = rankPosition(team.id)}
					{@const tc = teamColors[team.color] ?? { bg: '#27272a', border: '#3f3f46', text: '#fff' }}
					<div
						class="flex items-center gap-2 rounded-full border px-4 py-1.5"
						style="background: {tc.bg}28; border-color: {tc.border}44; color: {tc.text};"
					>
						<span class="text-sm font-black opacity-50">{ordinal(pos)}</span>
						<span class="text-sm font-bold">{team.display_name}</span>
						<span class="text-sm font-black tabular-nums opacity-70"
							>{team.setScore}<span class="text-xs opacity-60">pts</span></span
						>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Olympic podium: 2nd | 1st | 3rd -->
		{#if podiumSlots.length > 0}
			<div class="flex w-full max-w-5xl items-end justify-center gap-3 md:gap-6">
				{#each podiumSlots as slot}
					{@const revealed = isRevealed(slot.team.id)}
					{@const tc = teamColors[slot.team.color] ?? {
						bg: '#27272a',
						border: '#3f3f46',
						text: '#fff'
					}}
					{@const teamPlayers = data.playersByTeam[slot.team.id] ?? []}
					{@const isAnimating = animatingTeamId === slot.team.id}
					{@const fa = festivalAccent[slot.pos] ?? {
						color: '#ffffff',
						glow: 'rgba(255,255,255,0.3)'
					}}
					{@const isFirst = slot.pos === 1}

					<div class="flex flex-col items-center {isFirst ? 'w-2/5' : 'w-1/4'}">
						<!-- Team card or placeholder -->
						{#if revealed}
							<div
								class="w-full overflow-hidden rounded-2xl {isAnimating ? 'podium-reveal' : ''}"
								style="
									background-color: {tc.bg};
									border: 3px solid {fa.color};
									box-shadow: 0 0 {isAnimating ? '64px' : '28px'} {isAnimating ? '18px' : '6px'} {fa.glow},
									            inset 0 1px 0 rgba(255,255,255,0.08);
									transition: box-shadow 1.2s ease;
								"
							>
								<div class="p-4 text-center md:p-6" style="color: {tc.text};">
									<!-- Position ordinal with festival accent glow -->
									<div
										class="leading-none font-black tabular-nums"
										style="
											font-size: {isFirst ? 'clamp(3.5rem, 9vw, 7rem)' : 'clamp(2.5rem, 6.5vw, 5rem)'};
											color: {fa.color};
											text-shadow: 0 0 32px {fa.glow}, 0 2px 10px rgba(0,0,0,0.9);
										"
									>
										{ordinal(slot.pos)}
									</div>
									<!-- Team name -->
									<div
										class="mt-1 font-black tracking-wide uppercase"
										style="
											font-size: {isFirst ? 'clamp(1.4rem, 4vw, 2.8rem)' : 'clamp(1rem, 3vw, 2rem)'};
											text-shadow: 0 1px 6px rgba(0,0,0,0.7);
										"
									>
										{slot.team.display_name}
									</div>
									<!-- Score -->
									<div
										class="mt-1 font-black tabular-nums"
										style="
											font-size: {isFirst ? 'clamp(1.8rem, 5vw, 3.5rem)' : 'clamp(1.3rem, 3.5vw, 2.5rem)'};
											opacity: 0.88;
											text-shadow: 0 1px 4px rgba(0,0,0,0.7);
										"
									>
										{slot.team.setScore}
									</div>
									<div class="mt-0.5 text-xs tracking-[0.2em] uppercase opacity-45">points</div>

									<!-- Player avatars -->
									{#if teamPlayers.length > 0}
										<div class="mt-3 flex flex-wrap justify-center gap-2 md:mt-4">
											{#each teamPlayers as p}
												<div class="text-center">
													{#if p.photo_url}
														<img
															src={p.photo_url}
															alt={p.display_name}
															class="mx-auto rounded-full object-cover"
															style="
																width: {isFirst ? '38px' : '28px'};
																height: {isFirst ? '38px' : '28px'};
																border: 2px solid {tc.text}38;
															"
														/>
													{:else}
														<div
															class="mx-auto flex items-center justify-center rounded-full font-black"
															style="
																width: {isFirst ? '38px' : '28px'};
																height: {isFirst ? '38px' : '28px'};
																background: rgba(0,0,0,0.25);
																color: {tc.text};
																font-size: {isFirst ? '1rem' : '0.8rem'};
															"
														>
															{p.display_name.charAt(0)}
														</div>
													{/if}
													<div class="mt-0.5 text-xs opacity-65">{p.display_name}</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						{:else}
							<!-- Unrevealed placeholder -->
							<div
								class="w-full rounded-2xl border-2 border-dashed"
								style="
									border-color: {fa.color}30;
									background: rgba(255,255,255,0.02);
								"
							>
								<div
									class="flex flex-col items-center justify-center"
									style="padding: {isFirst ? '2.5rem 1rem' : '1.8rem 1rem'};"
								>
									<div
										class="animate-pulse leading-none font-black"
										style="
											font-size: {isFirst ? '5rem' : '3.5rem'};
											color: {fa.color}35;
										"
									>
										?
									</div>
									<div class="mt-2 text-xs tracking-[0.2em] uppercase" style="color: {fa.color}40;">
										{slot.pos === 1 ? 'Top spot' : slot.pos === 2 ? 'Runner up' : '3rd place'}
									</div>
								</div>
							</div>
						{/if}

						<!-- Festival-accent pedestal block -->
						<div
							class="mt-0.5 flex w-full items-center justify-center rounded-t-lg"
							style="
								height: {slot.pedestalPx}px;
								background: linear-gradient(to bottom, {fa.color}18 0%, {fa.color}06 100%);
								border-top: 3px solid {fa.color}60;
								box-shadow: 0 -6px 24px {fa.glow}50;
							"
						>
							<span
								class="font-black tabular-nums"
								style="
									font-size: {isFirst ? '2.8rem' : '2rem'};
									color: {fa.color};
									text-shadow: 0 0 24px {fa.glow};
								"
							>
								{slot.pos}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Complete state celebration -->
		{#if phase === 'complete'}
			<div class="mt-10 text-center">
				<p
					class="font-black tracking-[0.2em] uppercase"
					style="
						font-size: clamp(1.4rem, 4vw, 2.2rem);
						color: #ffe600;
						text-shadow: 0 0 28px rgba(255,230,0,0.55), 0 2px 8px rgba(0,0,0,0.8);
					"
				>
					🏆 Game Complete
				</p>
			</div>
		{/if}
	{/if}

	<!-- Live indicator -->
	<div class="mt-10 flex items-center gap-2 text-xs text-white/15">
		<span class="inline-block h-2 w-2 animate-pulse rounded-full" style="background: #ff2daa;"
		></span>
		Live
	</div>
</div>

<style>
	.wordmark {
		color: #ff2daa;
		text-shadow:
			0 0 48px rgba(255, 45, 170, 0.6),
			0 2px 14px rgba(0, 0, 0, 0.9);
	}

	.pulse-dot {
		display: inline-block;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		animation: pulse-glow 1.6s ease-in-out infinite;
	}

	@keyframes pulse-glow {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.4;
		}
		50% {
			transform: scale(1.6);
			opacity: 1;
		}
	}

	@keyframes podium-reveal {
		0% {
			transform: scale(0.55) translateY(40px);
			opacity: 0;
		}
		65% {
			transform: scale(1.07) translateY(-6px);
			opacity: 1;
		}
		100% {
			transform: scale(1) translateY(0);
			opacity: 1;
		}
	}

	.podium-reveal {
		animation: podium-reveal 0.85s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}
</style>
