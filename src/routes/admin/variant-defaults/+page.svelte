<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<div class="p-6 max-w-2xl">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-white">Variant Defaults</h1>
		<p class="mt-0.5 text-sm text-zinc-400">Default point values applied to all challenges of each variant</p>
	</div>

	<div class="space-y-3">
		{#each data.variants as v}
			<a href="/admin/variant-defaults/{v.variant}"
				class="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4 transition-colors hover:border-zinc-700">
				<div>
					<div class="font-semibold capitalize text-white">{v.variant}</div>
					<div class="mt-0.5 text-xs text-zinc-500">
						{v.fields.map((f) => `${f.field}: ${f.points}pts`).join(' · ')}
					</div>
				</div>
				<span class="text-zinc-600">→</span>
			</a>
		{/each}
	</div>
</div>
