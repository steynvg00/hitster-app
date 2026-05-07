<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<div class="min-h-screen flex items-center justify-center p-8 text-center">
	<div class="max-w-sm">
		<div class="mb-6 text-6xl">🎮</div>
		<h1 class="mb-3 text-2xl font-black text-white">Game already in progress</h1>
		<p class="mb-2 text-zinc-400 text-lg">
			<span class="font-semibold text-white">{data.setName}</span> has already started.
		</p>
		<p class="mb-8 text-zinc-500 text-sm">
			Ask the host if you can still join.
		</p>
		<a
			href="/"
			class="rounded-xl bg-zinc-800 px-6 py-3 text-sm font-bold text-zinc-200 hover:bg-zinc-700 transition-colors"
		>
			Back to home
		</a>
	</div>
</div>
