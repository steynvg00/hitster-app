<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const f = $derived(form as any);
</script>

<div class="p-6 max-w-lg">
	<div class="mb-2 flex items-center gap-2">
		<a href="/admin/variant-defaults" class="text-sm text-zinc-500 hover:text-zinc-300">← Defaults</a>
	</div>

	<h1 class="mb-1 text-2xl font-bold capitalize text-white">{data.variant}</h1>
	<p class="mb-6 text-sm text-zinc-400">Set the default point value for each field in this variant</p>

	{#if f?.saved}
		<div class="mb-4 rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300">
			Saved successfully
		</div>
	{/if}

	{#if f?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{f.error}</div>
	{/if}

	<form method="POST" action="?/save" use:enhance class="space-y-4">
		{#each data.fields as item}
			<div class="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-3">
				<label for="pts_{item.field}" class="font-medium capitalize text-zinc-200">
					{item.field.replace('_', ' ')}
				</label>
				<div class="flex items-center gap-2">
					<input
						id="pts_{item.field}"
						type="number"
						name="points_{item.field}"
						value={item.points}
						min="0"
						max="100"
						class="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-center text-sm text-white focus:outline-none"
					/>
					<span class="text-xs text-zinc-500">pts</span>
				</div>
			</div>
		{/each}

		<button type="submit"
			class="w-full rounded-xl bg-amber-500 py-3 font-bold text-black transition-colors hover:bg-amber-400">
			Save defaults
		</button>
	</form>
</div>
