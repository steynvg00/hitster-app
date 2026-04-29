<script lang="ts">
	interface Props {
		name: string;
		mode?: 'slider' | 'typeable_number';
		teamHex?: string;
		min?: number;
		max?: number;
		value?: number;
	}

	let {
		name,
		mode = 'slider',
		teamHex = '#ef4444',
		min = 1950,
		max = 2025,
		value = $bindable(1990)
	}: Props = $props();
</script>

<div>
	{#if mode === 'slider'}
		<div class="mb-3 text-center tabular-nums text-7xl font-black text-white">{value}</div>
		<input
			type="range"
			{name}
			{min}
			{max}
			bind:value
			class="w-full"
			style="accent-color: {teamHex};"
		/>
		<div class="mt-1 flex justify-between text-xs text-zinc-600">
			<span>{min}</span>
			<span>{max}</span>
		</div>
	{:else}
		<div class="flex items-center gap-3">
			<button
				type="button"
				onclick={() => (value = Math.max(min, value - 1))}
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-xl text-zinc-300 transition-colors hover:bg-zinc-800"
			>
				−
			</button>
			<input
				type="number"
				{name}
				bind:value
				{min}
				{max}
				class="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center tabular-nums text-3xl font-black text-white focus:outline-none"
			/>
			<button
				type="button"
				onclick={() => (value = Math.min(max, value + 1))}
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-xl text-zinc-300 transition-colors hover:bg-zinc-800"
			>
				+
			</button>
		</div>
	{/if}
</div>
