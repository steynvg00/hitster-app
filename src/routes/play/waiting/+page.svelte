<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import BattleRankingCard from '$lib/components/game/BattleRankingCard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let revealIndex = $state(untrack(() => data.recapRevealIndex));
	let ranking = $state<string[]>(untrack(() => data.recapRanking));

	// Whether this player's team has been revealed yet
	const myRankIndex = data.playerRankIndex; // 0-based, 0 = last place
	const revealed = $derived(myRankIndex !== -1 && ranking.length > 0 && myRankIndex < revealIndex);
	// Also handle: the ranking may not be set yet, but revealIndex advances — detect via index comparison
	const revealedByIndex = $derived(myRankIndex !== -1 && revealIndex > myRankIndex);

	let showRevealCard = $state(false);
	let revealCardDismissed = $state(false);

	const shouldShowReveal = $derived((revealed || revealedByIndex) && !revealCardDismissed);

	// ── Battle reveal (stuk 3c) ───────────────────────────────────────────────
	// Rides the SAME game_sets channel as the team cascade below — recap_state and
	// battle_reveal_index live on that row, so the existing subscription already
	// delivers them; no second channel. Kept strictly separate from revealIndex /
	// recapRanking: the team-reveal reaction above is untouched.
	let recapState = $state(untrack(() => data.recapState));
	let battleRevealIndex = $state(untrack(() => data.battleRevealIndex));

	const inBattlePhase = $derived(recapState === 'battle_reveal');
	// data.battles is already position-ordered; battle N is visible once
	// battleRevealIndex passes it. Newest first so the just-revealed battle leads.
	const revealedBattles = $derived(data.battles.slice(0, battleRevealIndex).reverse());

	const teamColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
		blue: { bg: '#3b82f6', border: '#2563eb', text: '#fff', glow: 'rgba(59,130,246,0.22)' },
		yellow: { bg: '#eab308', border: '#ca8a04', text: '#000', glow: 'rgba(234,179,8,0.18)' },
		green: { bg: '#22c55e', border: '#16a34a', text: '#000', glow: 'rgba(34,197,94,0.18)' },
		red: { bg: '#ef4444', border: '#dc2626', text: '#fff', glow: 'rgba(239,68,68,0.18)' },
		indigo: { bg: '#6366f1', border: '#4f46e5', text: '#fff', glow: 'rgba(99,102,241,0.22)' },
		black: { bg: '#1e293b', border: '#0f172a', text: '#fff', glow: 'rgba(30,41,59,0.25)' }
	};

	const c = $derived(
		teamColors[data.team.color] ?? {
			bg: '#6b7280',
			border: '#4b5563',
			text: '#fff',
			glow: 'rgba(107,114,128,0.2)'
		}
	);

	const ordinal = (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return n + (s[(v - 20) % 10] || s[v] || s[0]);
	};

	$effect(() => {
		if (shouldShowReveal) showRevealCard = true;
	});

	let carouselIdx = $state(0);
	const carouselLen = data.carouselChallenges.length;

	const variantLabel: Record<string, string> = {
		standard: 'Standard',
		anthem: 'Anthem',
		label: 'Label',
		mashup: 'Mashup',
		fragments: 'Fragments',
		effects: 'Effects',
		normal: 'Normal',
		vocal: 'Vocal',
		kick: 'Kick',
		battle: 'Battle'
	};

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`waiting-set-${data.setId}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'game_sets',
					filter: `id=eq.${data.setId}`
				},
				(payload) => {
					const updated = payload.new as {
						status: string;
						recap_state: string;
						recap_ranking: string[];
						recap_reveal_index: number;
						battle_reveal_index: number;
					};

					if (updated.recap_ranking) ranking = updated.recap_ranking as string[];
					if (updated.recap_reveal_index !== undefined) revealIndex = updated.recap_reveal_index;

					// Battle phase (stuk 3c) — same payload, separate counter.
					if (updated.recap_state) recapState = updated.recap_state;
					if (updated.battle_reveal_index !== undefined) {
						battleRevealIndex = updated.battle_reveal_index;
					}

					if (updated.recap_state === 'complete') {
						window.location.href = `/play/thanks?set_id=${data.setId}`;
					}
				}
			)
			.subscribe();

		let timer: ReturnType<typeof setInterval> | undefined;
		if (carouselLen > 1) {
			timer = setInterval(() => {
				carouselIdx = (carouselIdx + 1) % carouselLen;
			}, 6000);
		}

		return () => {
			supabaseBrowser.removeChannel(channel);
			if (timer !== undefined) clearInterval(timer);
		};
	});
</script>

<!-- ─── Fixed animated night-sky background ─── -->
<div class="fixed inset-0" style="background: #0b0b1f;">
	<!-- Magenta — top-right, slow breathe -->
	<div
		class="ambient-1 pointer-events-none absolute"
		style="
			top: -120px; right: -120px;
			width: min(60vw, 480px); height: min(60vw, 480px);
			background: radial-gradient(ellipse at center, rgba(255,45,170,0.14) 0%, transparent 68%);
		"
	></div>
	<!-- Cyan — bottom-left, slower breathe -->
	<div
		class="ambient-2 pointer-events-none absolute"
		style="
			bottom: -120px; left: -120px;
			width: min(55vw, 420px); height: min(55vw, 420px);
			background: radial-gradient(ellipse at center, rgba(0,229,255,0.11) 0%, transparent 68%);
		"
	></div>
	<!-- Violet — mid-center, very subtle -->
	<div
		class="ambient-3 pointer-events-none absolute"
		style="
			top: 30%; left: 25%;
			width: min(50vw, 360px); height: min(50vw, 360px);
			background: radial-gradient(ellipse at center, rgba(124,77,255,0.07) 0%, transparent 68%);
		"
	></div>
</div>

<!-- Team color top stripe — subtle identity anchor -->
<div class="fixed top-0 right-0 left-0 z-10 h-1" style="background: {c.bg};"></div>

<!-- ─── Full-screen reveal card (State 2) ─── -->
{#if showRevealCard && !revealCardDismissed}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
		style="background-color: {c.bg};"
	>
		<!-- CSS sparkle rings radiating from center (festival-yellow accent) -->
		<div class="spark-ring"></div>
		<div class="spark-ring" style="animation-delay: 0.85s;"></div>

		<!-- Subtle festival yellow ambient glow over team color bg -->
		<div
			class="pointer-events-none absolute inset-0"
			style="background: radial-gradient(ellipse at 50% 35%, rgba(255,230,0,0.07) 0%, transparent 58%);"
		></div>

		<!-- Reveal content — bounceIn preserved exactly -->
		<div class="relative w-full max-w-sm animate-[bounceIn_0.6s_ease-out] px-8 py-12 text-center">
			<!-- Position ordinal -->
			<div class="mb-4 text-9xl font-black tabular-nums" style="color: {c.text};">
				{data.playerPosition !== null ? ordinal(data.playerPosition) : '🎉'}
			</div>
			<!-- Team name -->
			<div
				class="mb-2 text-2xl font-black tracking-wide uppercase"
				style="color: {c.text}; opacity: 0.85;"
			>
				{data.team.display_name}
			</div>
			<!-- Score -->
			<div class="mb-1 text-4xl font-black tabular-nums" style="color: {c.text}; opacity: 0.9;">
				{data.playerSetScore} pts
			</div>

			<!-- Teammates -->
			{#if data.teammates.length > 0}
				<div class="mt-6 flex flex-wrap justify-center gap-3">
					{#each data.teammates as p}
						<div class="text-center">
							{#if p.photo_url}
								<img
									src={p.photo_url}
									alt={p.display_name}
									class="mx-auto h-14 w-14 rounded-full border-2 object-cover"
									style="border-color: rgba(255,255,255,0.4)"
								/>
							{:else}
								<div
									class="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2"
									style="background-color: rgba(0,0,0,0.2); color: {c.text}; border-color: rgba(255,255,255,0.4);"
								>
									<span class="text-xl font-black">{p.display_name.charAt(0)}</span>
								</div>
							{/if}
							<div class="mt-1 text-xs font-semibold" style="color: {c.text}; opacity: 0.8;">
								{p.display_name}
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<button
				onclick={() => (revealCardDismissed = true)}
				class="mt-8 rounded-xl border-2 px-8 py-3 text-base font-bold transition-opacity hover:opacity-80"
				style="border-color: rgba(255,255,255,0.5); color: {c.text};"
			>
				See all teams
			</button>
		</div>
	</div>
{/if}

<!-- ─── Waiting screen (States 1 + 3) ─── -->
<div class="relative flex min-h-screen items-center justify-center px-6 py-16">
	<div class="w-full max-w-sm text-center">
		<!-- Festival-palette color-cycling pulse element -->
		<div class="relative mx-auto mb-10 h-24 w-24">
			<div class="festival-ping absolute inset-0 rounded-full"></div>
			<div class="festival-pulse absolute inset-2 rounded-full"></div>
			<div class="festival-glow absolute inset-4 flex items-center justify-center rounded-full">
				<span class="text-2xl">🎵</span>
			</div>
		</div>

		<!-- Heading + subhead — state-dependent -->
		{#if inBattlePhase}
			<!-- State 0 (stuk 3c): battles resolve before the team podium -->
			<h1
				class="font-black text-mixup-ice"
				style="font-size: clamp(2rem, 7vw, 3rem); letter-spacing: -0.02em; line-height: 1.1;"
			>
				⚔️ Battle results
			</h1>
			<p class="mt-4 text-base leading-relaxed text-mixup-ice/40">
				{revealedBattles.length === 0
					? 'The host is about to reveal the battles'
					: 'Bonus points from the head-to-heads'}
			</p>
		{:else if revealCardDismissed}
			<!-- State 3: post-reveal -->
			<h1
				class="font-black text-white"
				style="font-size: clamp(2rem, 7vw, 3rem); letter-spacing: -0.02em; line-height: 1.1;"
			>
				{data.playerPosition !== null
					? `You placed ${ordinal(data.playerPosition)}!`
					: "You're on the board!"}
			</h1>
			<!-- Team rank badge -->
			<div
				class="mx-auto mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold tracking-widest uppercase"
				style="background: {c.bg}22; border: 1px solid {c.border}55; color: {c.border};"
			>
				{data.team.display_name}
				{#if data.playerPosition !== null}
					· {ordinal(data.playerPosition)} of {data.totalTeams}
				{/if}
			</div>
			<p class="mt-4 text-base leading-relaxed text-mixup-ice/45">Watch for the other teams</p>
		{:else}
			<!-- State 1: standard waiting -->
			<h1
				class="font-black text-mixup-ice"
				style="font-size: clamp(2rem, 7vw, 3rem); letter-spacing: -0.02em; line-height: 1.1;"
			>
				The recap begins…
			</h1>
			<p class="mt-4 text-base leading-relaxed text-mixup-ice/40">
				Eyes up — watch the host's screen
			</p>
		{/if}

		<!-- ─── Battle ranking cards (stuk 3c) ─── -->
		<!-- Own team highlighted; shared ranks repeat verbatim from the stored
		     ranking. Only rendered during battle_reveal — once the host hands over
		     to 'revealing', the existing team-reveal flow below takes over
		     untouched, and a non-battle set never enters this phase at all. -->
		{#if inBattlePhase && revealedBattles.length > 0}
			<div class="mt-8 space-y-3 text-left">
				{#each revealedBattles as battle (battle.challenge_id)}
					<BattleRankingCard
						title={battle.title}
						ranking={battle.ranking}
						teams={data.battleTeams}
						highlightTeamId={data.team.id}
						compact
					/>
				{/each}
			</div>
		{/if}

		<!-- ─── Waiting carousel ─── -->
		<!-- Hidden during the battle phase: it's "while you wait" filler, and the
		     battles are the thing to watch. -->
		{#if carouselLen > 0 && !inBattlePhase}
			<div class="mt-10">
				<p class="mb-4 text-xs font-semibold tracking-[0.22em] text-white/28 uppercase">
					While you wait…
				</p>
				<div
					class="relative min-h-[80px] overflow-hidden rounded-2xl px-6 py-5 text-left"
					style="
						background: rgba(255,255,255,0.03);
						border: 1px solid rgba(0,229,255,0.2);
						box-shadow: 0 0 24px rgba(0,229,255,0.05);
					"
				>
					{#if data.carouselChallenges[carouselIdx]}
						<div class="flex items-start gap-3">
							<span class="mt-0.5 text-xl">🎵</span>
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm leading-snug font-bold text-mixup-ice">
									{data.carouselChallenges[carouselIdx].title}
								</div>
								<div class="mt-1">
									<span
										class="rounded-full border px-2 py-0.5 text-xs font-semibold"
										style="background-color: {c.bg}1a; color: {c.bg}; border-color: {c.bg}44;"
									>
										{variantLabel[data.carouselChallenges[carouselIdx].variant] ??
											data.carouselChallenges[carouselIdx].variant}
									</span>
								</div>
							</div>
						</div>
					{/if}
				</div>

				{#if carouselLen > 1}
					<div class="mt-3 flex items-center justify-center gap-2">
						<button
							onclick={() => (carouselIdx = (carouselIdx - 1 + carouselLen) % carouselLen)}
							class="px-1 text-mixup-ice/25 transition-colors hover:text-mixup-ice/60">‹</button
						>
						{#each data.carouselChallenges as _, i}
							<button
								onclick={() => (carouselIdx = i)}
								class="rounded-full transition-all duration-300 {i === carouselIdx
									? 'h-1.5 w-4'
									: 'h-1.5 w-1.5 hover:opacity-60'}"
								style="background: {i === carouselIdx ? '#00e5ff' : 'rgba(255,255,255,0.2)'};"
							></button>
						{/each}
						<button
							onclick={() => (carouselIdx = (carouselIdx + 1) % carouselLen)}
							class="px-1 text-mixup-ice/25 transition-colors hover:text-mixup-ice/60">›</button
						>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Live indicator -->
		<div class="mt-10 flex items-center justify-center gap-2 text-xs text-white/20">
			<span class="inline-block h-2 w-2 animate-pulse rounded-full" style="background: #ff2daa;"
			></span>
			Waiting for host
		</div>
	</div>
</div>

<style>
	/* ── Ambient background slow-breathe ── */
	@keyframes ambient-breathe {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.45;
			transform: scale(1.12);
		}
	}

	.ambient-1 {
		animation: ambient-breathe 10s ease-in-out infinite;
	}
	.ambient-2 {
		animation: ambient-breathe 13s ease-in-out infinite 3.5s;
	}
	.ambient-3 {
		animation: ambient-breathe 8s ease-in-out infinite 6s;
	}

	/* ── Festival-palette color-cycling pulse ── */
	@keyframes festival-ping {
		0% {
			transform: scale(1);
			opacity: 0.65;
			background-color: rgba(255, 45, 170, 0.14);
		}
		30% {
			background-color: rgba(0, 229, 255, 0.14);
		}
		60% {
			background-color: rgba(124, 77, 255, 0.14);
		}
		75%,
		100% {
			transform: scale(2.5);
			opacity: 0;
		}
	}

	.festival-ping {
		animation: festival-ping 3s ease-out infinite;
	}

	@keyframes festival-pulse {
		0%,
		100% {
			opacity: 0.35;
			background-color: rgba(255, 45, 170, 0.22);
		}
		33% {
			background-color: rgba(0, 229, 255, 0.22);
		}
		50% {
			opacity: 0.58;
		}
		66% {
			background-color: rgba(124, 77, 255, 0.22);
		}
	}

	.festival-pulse {
		animation: festival-pulse 3s ease-in-out infinite 0.5s;
	}

	@keyframes festival-glow {
		0%,
		100% {
			background-color: rgba(255, 45, 170, 0.58);
			box-shadow: 0 0 22px rgba(255, 45, 170, 0.55);
		}
		33% {
			background-color: rgba(0, 229, 255, 0.58);
			box-shadow: 0 0 22px rgba(0, 229, 255, 0.55);
		}
		66% {
			background-color: rgba(124, 77, 255, 0.58);
			box-shadow: 0 0 22px rgba(124, 77, 255, 0.55);
		}
	}

	.festival-glow {
		animation: festival-glow 3s ease-in-out infinite 1s;
	}

	/* ── Reveal card sparkle rings ── */
	@keyframes spark-expand {
		0% {
			transform: scale(0.25);
			opacity: 0.75;
		}
		100% {
			transform: scale(4);
			opacity: 0;
		}
	}

	.spark-ring {
		position: absolute;
		left: calc(50% - 100px);
		top: calc(50% - 100px);
		width: 200px;
		height: 200px;
		border-radius: 50%;
		border: 2px solid rgba(255, 230, 0, 0.32);
		animation: spark-expand 2.2s ease-out infinite;
		pointer-events: none;
	}

	/* ── bounceIn — preserved exactly ── */
	@keyframes bounceIn {
		0% {
			transform: scale(0.3);
			opacity: 0;
		}
		50% {
			transform: scale(1.1);
			opacity: 1;
		}
		70% {
			transform: scale(0.95);
		}
		100% {
			transform: scale(1);
		}
	}
</style>
