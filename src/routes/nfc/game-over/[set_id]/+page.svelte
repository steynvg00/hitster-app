<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<div class="min-h-screen flex items-center justify-center p-8 text-center">
	<div class="max-w-sm">
		<div class="mb-6 text-6xl">🏁</div>
		<h1 class="mb-3 text-2xl font-black text-white">Game over</h1>
		<p class="mb-8 text-zinc-400 text-lg">
			<span class="font-semibold text-white">{data.setName}</span> has ended.
			Check the leaderboard to see the results!
		</p>
		<a
			href="/leaderboard"
			class="inline-block rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-zinc-950 hover:bg-amber-300 transition-colors"
		>
			View leaderboard →
		</a>
	</div>
</div>
