<script lang="ts">
	import HomepageBackground from '$lib/components/HomepageBackground.svelte';
	import HostAuthForm from '$lib/components/HostAuthForm.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>MixUp!</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
	<link
		href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<!-- Animated background (z-index 0) -->
<HomepageBackground />

<!-- Dark overlay -->
<div class="fixed inset-0" style="z-index: 1; background: rgba(10,10,15,0.42);"></div>

<!-- Foreground content -->
<div
	class="relative flex min-h-screen flex-col items-center justify-center px-6 py-16"
	style="z-index: 10;"
>
	<!-- Wordmark -->
	<div class="mb-10 text-center">
		<h1
			class="text-[5rem] font-black uppercase leading-none tracking-tighter text-white drop-shadow-lg sm:text-[7rem]"
		>
			MixUp!
		</h1>
		<p class="tagline mt-3 text-base text-white">music games for parties</p>
	</div>

	<!-- Host login card -->
	<div class="w-full max-w-sm">
		<div class="rounded-2xl border border-zinc-700/60 bg-zinc-900/90 p-6 shadow-2xl backdrop-blur-sm">
			<div class="mb-4 text-center">
				<span class="text-xs font-semibold uppercase tracking-widest text-zinc-400">Host login</span>
			</div>

			{#if data.loggedIn}
				<a
					href="/admin"
					class="flex w-full items-center justify-center rounded-lg bg-amber-400 px-4 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
				>
					Go to dashboard →
				</a>
			{:else}
				<div class="space-y-3">
					<HostAuthForm {form} />
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.tagline {
		font-family: 'Nunito', sans-serif;
		font-weight: 600;
		text-shadow: 0 1px 8px rgba(0, 0, 0, 0.75);
	}
</style>
