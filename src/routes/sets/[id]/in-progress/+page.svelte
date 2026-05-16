<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-zinc-950 p-8 text-center">
	<div class="max-w-sm">
		<div class="mb-6 text-6xl">🎮</div>
		<h1 class="mb-3 text-2xl font-black text-white">Game already in progress</h1>
		<p class="mb-2 text-lg text-zinc-400">
			<span class="font-semibold text-white">{data.setName}</span> has already started.
		</p>
		<p class="mb-8 text-sm text-zinc-500">Ask the host if you can still join.</p>
		<div class="flex flex-col gap-3">
			<a
				href="/leaderboard"
				class="inline-block rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
			>
				View Game →
			</a>
			<a
				href="/"
				class="inline-block rounded-xl bg-zinc-800 px-6 py-3 text-sm font-bold text-zinc-200 transition-colors hover:bg-zinc-700"
			>
				Back to home
			</a>
		</div>
	</div>
</div>
