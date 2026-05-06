<script lang="ts">
	import HomepageBackground from '$lib/components/HomepageBackground.svelte';
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

<!-- Dark overlay — reduced to 0.42 so background colors pop through (z-index 1) -->
<div class="fixed inset-0" style="z-index: 1; background: rgba(10,10,15,0.42);"></div>

<!-- Foreground content (z-index 10) -->
<div
	class="relative flex min-h-screen flex-col items-center justify-center px-6 py-16"
	style="z-index: 10;"
>
	<div class="mb-12 text-center">
		<h1
			class="text-[5rem] font-black uppercase leading-none tracking-tighter text-white drop-shadow-lg sm:text-[7rem]"
		>
			MixUp!
		</h1>
		<p class="tagline mt-3 text-base text-white">music games for parties</p>
	</div>

	<div class="flex w-full max-w-xs flex-col gap-4">
		<a href="/admin/login" class="host-btn">Host login</a>
	</div>
</div>

<style>
	.tagline {
		font-family: 'Nunito', sans-serif;
		font-weight: 600;
		text-shadow: 0 1px 8px rgba(0, 0, 0, 0.75);
	}

	.host-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.25rem 1.5rem;
		border-radius: 1rem;
		font-family: 'Nunito', sans-serif;
		font-size: 1.125rem;
		font-weight: 700;
		text-decoration: none;
		background: #fbbf24;
		color: #09090b;
		transition:
			transform 0.12s ease,
			filter 0.12s ease;
	}
	.host-btn:hover {
		filter: brightness(1.08);
	}
	.host-btn:active {
		transform: scale(0.97);
	}
</style>
