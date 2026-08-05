<script lang="ts">
	interface Props {
		name: string;
		mode?: 'slider' | 'typeable_number';
		teamHex?: string;
		min?: number;
		max?: number;
		value?: number;
		/**
		 * Fired when the TEAM actually operates this input (drag, type, ± button).
		 * A year field always holds a number, so a caller tracking "did they answer
		 * this?" cannot derive it from the value — and must not, because the browser
		 * itself rewrites an out-of-range initial value (it clamps to `min`, which
		 * Svelte's binding then writes back during hydration). A real DOM event
		 * fires for none of that, which is exactly why the signal lives here.
		 */
		ontouched?: () => void;
	}

	let {
		name,
		mode = 'slider',
		teamHex = '#ef4444',
		min = 2000,
		max = 2026,
		value = $bindable(2013),
		ontouched
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
			oninput={() => ontouched?.()}
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
				onclick={() => {
					value = Math.max(min, value - 1);
					ontouched?.();
				}}
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-xl text-zinc-300 transition-colors hover:bg-zinc-800"
			>
				−
			</button>
			<input
				type="number"
				{name}
				bind:value
				oninput={() => ontouched?.()}
				{min}
				{max}
				class="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center tabular-nums text-3xl font-black text-white focus:outline-none"
			/>
			<button
				type="button"
				onclick={() => {
					value = Math.min(max, value + 1);
					ontouched?.();
				}}
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-700 text-xl text-zinc-300 transition-colors hover:bg-zinc-800"
			>
				+
			</button>
		</div>
	{/if}
</div>
