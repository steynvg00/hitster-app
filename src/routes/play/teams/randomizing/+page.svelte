<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Animation: roll → reveal → hold → show button
	// Phase: 'rolling' | 'reveal' | 'done'
	let phase = $state<'rolling' | 'reveal' | 'done'>('rolling');

	// Kick off the animation sequence on mount
	import { onMount } from 'svelte';

	onMount(() => {
		const t1 = setTimeout(() => { phase = 'reveal'; }, 1800);
		const t2 = setTimeout(() => { phase = 'done'; }, 3600);
		return () => { clearTimeout(t1); clearTimeout(t2); };
	});
</script>

<svelte:head>
	<title>Your Team — Hitster</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-center">

	{#if phase === 'rolling'}
		<!-- Rolling spinner -->
		<div class="mb-6 text-6xl animate-spin" style="animation-duration: 0.4s">🎲</div>
		<p class="text-lg font-semibold text-zinc-300">Finding your team…</p>

	{:else if phase === 'reveal'}
		<!-- Reveal pulse -->
		<div
			class="mb-6 flex h-28 w-28 items-center justify-center rounded-full text-5xl font-black text-white animate-[ping_0.6s_ease-out]"
			style="background-color: {data.bg};"
		>
			!
		</div>
		<p class="text-xl font-black text-white">{data.label}</p>
		<p class="mt-1 text-sm text-zinc-400">You're on this team!</p>

	{:else}
		<!-- Done — show continue button -->
		<div
			class="mb-6 flex h-28 w-28 items-center justify-center rounded-full text-5xl font-black text-white"
			style="background-color: {data.bg};"
		>
			✓
		</div>
		<p class="mb-1 text-2xl font-black text-white">{data.label}</p>
		<p class="mb-8 text-sm text-zinc-400">You've been assigned to this team</p>

		<a
			href="/team"
			class="rounded-xl bg-amber-400 px-8 py-4 text-lg font-black text-zinc-950 transition-all hover:bg-amber-300 active:scale-[0.98]"
		>
			Go to my team →
		</a>
	{/if}

</div>

<style>
	@keyframes ping {
		0%   { transform: scale(0.5); opacity: 0; }
		60%  { transform: scale(1.15); opacity: 1; }
		100% { transform: scale(1); opacity: 1; }
	}
</style>
