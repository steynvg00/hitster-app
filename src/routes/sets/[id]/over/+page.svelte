<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-zinc-950 p-8 text-center">
	<div class="max-w-sm">
		<div class="mb-6 text-6xl">🏁</div>
		<h1 class="mb-3 text-2xl font-black text-white">Game over</h1>
		<p class="mb-8 text-lg text-zinc-400">
			<span class="font-semibold text-white">{data.setName}</span> has ended. Check the leaderboard
			to see the results!
		</p>
		<a
			href="/leaderboard"
			class="inline-block rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
		>
			View leaderboard →
		</a>
	</div>
</div>
