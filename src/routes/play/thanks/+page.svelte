<script lang="ts">
	import type { PageData } from './$types';
	import { getVariantIcon, getVariantColor } from '$lib/variants';

	let { data }: { data: PageData } = $props();

	const teamColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
		blue: { bg: '#1d4ed8', border: '#3b82f6', text: '#fff', glow: 'rgba(59,130,246,0.18)' },
		yellow: { bg: '#ca8a04', border: '#eab308', text: '#000', glow: 'rgba(234,179,8,0.15)' },
		green: { bg: '#15803d', border: '#22c55e', text: '#fff', glow: 'rgba(34,197,94,0.15)' },
		red: { bg: '#b91c1c', border: '#ef4444', text: '#fff', glow: 'rgba(239,68,68,0.15)' },
		indigo: { bg: '#4338ca', border: '#6366f1', text: '#fff', glow: 'rgba(99,102,241,0.18)' },
		black: { bg: '#18181b', border: '#3f3f46', text: '#fff', glow: 'rgba(63,63,70,0.22)' }
	};

	const tc = $derived(
		teamColors[data.team.color] ?? {
			bg: '#27272a',
			border: '#52525b',
			text: '#fff',
			glow: 'rgba(82,82,91,0.18)'
		}
	);

	// Best-scoring challenge (highest positive score)
	const bestChallenge = $derived(
		data.challengeResults
			.filter((ch) => ch.score !== null && ch.score > 0)
			.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null
	);

	const challengesPlayed = $derived(data.challengeResults.filter((ch) => ch.score !== null).length);
</script>

<svelte:head>
	<title>Thanks for playing — {data.setName}</title>
</svelte:head>

<!-- Night-sky background: calmer than podium — single ambient gradient -->
<div class="fixed inset-0" style="background: #0b0b1f;">
	<div
		class="absolute inset-0"
		style="background:
			radial-gradient(ellipse at 88% 0%, rgba(255,45,170,0.08) 0%, transparent 45%),
			radial-gradient(ellipse at 50% 100%, rgba(0,0,0,0.5) 0%, transparent 60%);"
	></div>
</div>

<div class="relative flex min-h-screen flex-col">
	<!-- ─── Hero section ─── -->
	<div
		class="hero-enter relative px-6 pt-12 pb-10 text-center"
		style="background: radial-gradient(ellipse at 50% 0%, {tc.glow} 0%, transparent 62%);"
	>
		<!-- Team color stripe at very top -->
		<div
			class="absolute top-0 right-0 left-0 h-1.5 rounded-none"
			style="background: {tc.bg};"
		></div>

		<!-- Team identity pill -->
		<div
			class="mb-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold tracking-widest uppercase"
			style="background: {tc.bg}22; border: 1px solid {tc.border}50; color: {tc.border};"
		>
			{data.team.display_name}
		</div>

		<!-- Display heading -->
		<h1
			class="leading-none font-black tracking-tight text-white uppercase"
			style="font-size: clamp(2.2rem, 8vw, 4rem);"
		>
			That's a wrap.
		</h1>

		{#if data.playerName}
			<p class="mt-3 text-lg font-semibold text-mixup-ice/65">{data.playerName}</p>
		{/if}

		<p class="mt-1 text-xs tracking-[0.22em] text-white/25 uppercase">{data.setName}</p>

		<!-- Hero score -->
		<div class="mt-8">
			<div class="mb-1.5 text-xs font-semibold tracking-[0.25em] text-white/28 uppercase">
				Total score
			</div>
			<div
				class="leading-none font-black tabular-nums"
				style="
					font-size: clamp(3.5rem, 14vw, 5.5rem);
					color: #ffe600;
					text-shadow: 0 0 36px rgba(255,230,0,0.32), 0 2px 10px rgba(0,0,0,0.8);
				"
			>
				{data.totalScore}
			</div>
			<div class="mt-1 text-xs tracking-[0.25em] text-white/22 uppercase">points</div>
		</div>

		<!-- Stat line -->
		{#if challengesPlayed > 0}
			<div class="mt-6">
				<span
					class="rounded-full px-3 py-1 text-xs font-semibold tracking-wider text-white/35 uppercase"
					style="background: rgba(255,255,255,0.05);"
				>
					{challengesPlayed}
					{challengesPlayed === 1 ? 'challenge' : 'challenges'} played
				</span>
			</div>
		{/if}
	</div>

	<!-- ─── Body content ─── -->
	<div class="mx-auto w-full max-w-lg space-y-5 px-4 py-6">
		<!-- Best moment achievement callout -->
		{#if bestChallenge}
			<div
				class="card-enter flex items-center gap-3 rounded-xl px-4 py-3"
				style="
					background: rgba(255,45,170,0.07);
					border: 1px solid rgba(255,45,170,0.22);
					animation-delay: 80ms;
				"
			>
				<span class="text-xl leading-none">⭐</span>
				<div class="min-w-0 flex-1">
					<div class="text-xs font-semibold tracking-widest text-mixup-magenta/60 uppercase">
						Best moment
					</div>
					<div class="truncate text-sm font-bold text-white">{bestChallenge.title}</div>
				</div>
				<div class="shrink-0 text-right text-lg font-black tabular-nums" style="color: #ff2daa;">
					+{bestChallenge.score}
				</div>
			</div>
		{/if}

		<!-- Challenges played list -->
		{#if data.challengeResults.length > 0}
			<div>
				<h2 class="mb-3 text-xs font-bold tracking-[0.22em] text-white/28 uppercase">
					Your challenges
				</h2>
				<div class="space-y-2">
					{#each data.challengeResults as ch, i}
						{@const VariantIcon = getVariantIcon(ch.variant)}
						{@const variantColor = getVariantColor(ch.variant)}
						<div
							class="card-enter overflow-hidden rounded-xl"
							style="
								background: rgba(255,255,255,0.03);
								border: 1px solid rgba(255,255,255,0.06);
								border-left: 3px solid rgba(0,229,255,0.45);
								animation-delay: {(i + (bestChallenge ? 2 : 1)) * 80}ms;
							"
						>
							<div class="flex items-center gap-3 px-4 py-3">
								<!-- Variant icon badge -->
								<div
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {variantColor}"
								>
									<VariantIcon size={14} />
								</div>

								<!-- Name + variant -->
								<div class="min-w-0 flex-1">
									<div class="truncate font-semibold text-mixup-ice">{ch.title}</div>
									<div class="text-xs text-white/30 capitalize">{ch.variant}</div>
								</div>

								<!-- Score -->
								<div class="shrink-0 text-right">
									{#if ch.score !== null}
										<div
											class="text-sm font-black tabular-nums"
											style="color: {ch.score > 0 ? '#ffe600' : 'rgba(255,255,255,0.35)'};"
										>
											{ch.score > 0 ? '+' : ''}{ch.score}
										</div>
										<div class="text-xs text-white/22">pts</div>
									{:else}
										<div class="text-xs text-white/22">—</div>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<!-- Edge case: no challenges at all -->
			<div
				class="card-enter rounded-xl border p-8 text-center"
				style="background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.05);"
			>
				<p class="text-white/35">No challenges played this set</p>
				<p class="mt-1 text-sm text-white/20">Thanks for being here!</p>
			</div>
		{/if}

		<!-- Play again button -->
		<div class="pt-1">
			<a
				href="/"
				class="flex w-full items-center justify-center rounded-xl py-3.5 text-base font-bold transition-opacity hover:opacity-85"
				style="background: {tc.bg}; color: {tc.text};"
			>
				Play again
			</a>
		</div>

		<!-- Closing section -->
		<div class="border-t pt-6 pb-8 text-center" style="border-color: rgba(0,229,255,0.1);">
			<p class="text-sm text-mixup-ice/25 italic">Thanks for playing. See you next time.</p>
		</div>
	</div>
</div>

<style>
	@keyframes fade-in-down {
		from {
			opacity: 0;
			transform: translateY(-16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.hero-enter {
		animation: fade-in-down 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes card-slide-in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.card-enter {
		animation: card-slide-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
</style>
