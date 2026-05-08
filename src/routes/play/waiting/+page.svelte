<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let revealIndex = $state(untrack(() => data.recapRevealIndex));
	let ranking = $state<string[]>(untrack(() => data.recapRanking));

	// Whether this player's team has been revealed yet
	const myRankIndex = data.playerRankIndex; // 0-based, 0 = last place
	const revealed = $derived(
		myRankIndex !== -1 && ranking.length > 0 && myRankIndex < revealIndex
	);
	// Also handle: the ranking may not be set yet, but revealIndex advances — detect via index comparison
	const revealedByIndex = $derived(
		myRankIndex !== -1 && revealIndex > myRankIndex
	);

	let showRevealCard = $state(false);
	let revealCardDismissed = $state(false);

	const shouldShowReveal = $derived(
		(revealed || revealedByIndex) && !revealCardDismissed
	);

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

	$effect(() => {
		if (shouldShowReveal) showRevealCard = true;
	});

	let carouselIdx = $state(0);
	const carouselLen = data.carouselChallenges.length;

	const variantLabel: Record<string, string> = {
		normal: 'Normal', label: 'Label', anthem: 'Anthem', vocal: 'Vocal',
		fragments: 'Fragments', kick: 'Kick', mashup: 'Mashup', battle: 'Battle'
	};

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`waiting-set-${data.setId}`)
			.on('postgres_changes', {
				event: 'UPDATE',
				schema: 'public',
				table: 'game_sets',
				filter: `id=eq.${data.setId}`
			}, (payload) => {
				const updated = payload.new as {
					status: string;
					recap_state: string;
					recap_ranking: string[];
					recap_reveal_index: number;
				};

				if (updated.recap_ranking) ranking = updated.recap_ranking as string[];
				if (updated.recap_reveal_index !== undefined) revealIndex = updated.recap_reveal_index;

				if (updated.recap_state === 'complete') {
					window.location.href = `/play/thanks?set_id=${data.setId}`;
				}
			})
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

<!-- Full-screen reveal card (shown when this team is revealed) -->
{#if showRevealCard && !revealCardDismissed}
	<div class="fixed inset-0 z-50 flex items-center justify-center"
		style="background-color: {c.bg};">
		<div class="text-center px-8 py-12 max-w-sm w-full animate-[bounceIn_0.6s_ease-out]">
			<!-- Position -->
			<div class="mb-4 text-9xl font-black tabular-nums" style="color: {c.text};">
				{data.playerPosition !== null ? ordinal(data.playerPosition) : '🎉'}
			</div>
			<!-- Team name -->
			<div class="text-2xl font-black uppercase tracking-wide mb-2" style="color: {c.text}; opacity: 0.85;">
				{data.team.display_name}
			</div>
			<!-- Score -->
			<div class="text-4xl font-black tabular-nums mb-1" style="color: {c.text}; opacity: 0.9;">
				{data.playerSetScore} pts
			</div>

			<!-- Teammates -->
			{#if data.teammates.length > 0}
				<div class="mt-6 flex flex-wrap justify-center gap-3">
					{#each data.teammates as p}
						<div class="text-center">
							{#if p.photo_url}
								<img src={p.photo_url} alt={p.display_name}
									class="h-14 w-14 rounded-full object-cover border-2 mx-auto"
									style="border-color: rgba(255,255,255,0.4)" />
							{:else}
								<div class="flex h-14 w-14 items-center justify-center rounded-full mx-auto border-2"
									style="background-color: rgba(0,0,0,0.2); color: {c.text}; border-color: rgba(255,255,255,0.4);">
									<span class="text-xl font-black">{p.display_name.charAt(0)}</span>
								</div>
							{/if}
							<div class="mt-1 text-xs font-semibold" style="color: {c.text}; opacity: 0.8;">{p.display_name}</div>
						</div>
					{/each}
				</div>
			{/if}

			<button
				onclick={() => (revealCardDismissed = true)}
				class="mt-8 rounded-xl border-2 px-8 py-3 text-base font-bold transition-opacity hover:opacity-80"
				style="border-color: rgba(255,255,255,0.5); color: {c.text};">
				See all teams
			</button>
		</div>
	</div>
{/if}

<!-- Waiting screen -->
<div class="min-h-screen flex items-center justify-center bg-zinc-950">
	<div class="text-center px-8 py-16 max-w-sm">
		<div class="relative mx-auto mb-10 h-24 w-24">
			<div class="absolute inset-0 rounded-full bg-amber-400/20 animate-ping"></div>
			<div class="absolute inset-2 rounded-full bg-amber-400/30 animate-pulse"></div>
			<div class="absolute inset-4 flex items-center justify-center rounded-full bg-amber-400/50">
				<span class="text-2xl">🎵</span>
			</div>
		</div>

		<h1 class="mb-4 text-3xl font-black text-white">Results incoming…</h1>
		<p class="text-lg text-zinc-400 leading-relaxed">
			The host is tallying the scores.<br />
			Stand by for the big reveal!
		</p>

		{#if carouselLen > 0}
			<div class="mt-10">
				<p class="text-xs font-semibold uppercase tracking-widest text-zinc-600 mb-4">While you wait…</p>
				<div class="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-5 text-left min-h-[80px]">
					{#if data.carouselChallenges[carouselIdx]}
						<div class="flex items-start gap-3">
							<span class="text-xl mt-0.5">🎵</span>
							<div class="flex-1 min-w-0">
								<div class="text-sm font-bold text-white leading-snug truncate">{data.carouselChallenges[carouselIdx].title}</div>
								<div class="mt-1">
									<span class="rounded-full px-2 py-0.5 text-xs font-semibold"
										style="background-color: {c.bg}22; color: {c.bg}; border: 1px solid {c.bg}44;">
										{variantLabel[data.carouselChallenges[carouselIdx].variant] ?? data.carouselChallenges[carouselIdx].variant}
									</span>
								</div>
							</div>
						</div>
					{/if}
				</div>

				{#if carouselLen > 1}
					<div class="mt-3 flex items-center justify-center gap-2">
						<button
							onclick={() => carouselIdx = (carouselIdx - 1 + carouselLen) % carouselLen}
							class="text-zinc-600 hover:text-zinc-400 transition-colors px-1">‹</button>
						{#each data.carouselChallenges as _, i}
							<button
								onclick={() => carouselIdx = i}
								class="h-1.5 rounded-full transition-all duration-300 {i === carouselIdx ? 'w-4 bg-amber-400' : 'w-1.5 bg-zinc-700 hover:bg-zinc-500'}">
							</button>
						{/each}
						<button
							onclick={() => carouselIdx = (carouselIdx + 1) % carouselLen}
							class="text-zinc-600 hover:text-zinc-400 transition-colors px-1">›</button>
					</div>
				{/if}
			</div>
		{/if}

		<div class="mt-10 flex items-center justify-center gap-2 text-xs text-zinc-600">
			<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
			Waiting for host
		</div>
	</div>
</div>

<style>
	@keyframes bounceIn {
		0% { transform: scale(0.3); opacity: 0; }
		50% { transform: scale(1.1); opacity: 1; }
		70% { transform: scale(0.95); }
		100% { transform: scale(1); }
	}
</style>
