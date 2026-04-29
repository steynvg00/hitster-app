<script lang="ts">
	interface Props {
		name: string;
		options: string[];
		teamHex?: string;
		value?: string;
	}

	let { name, options, teamHex = '#ef4444', value = $bindable('') }: Props = $props();
</script>

<div class="grid gap-2">
	{#each options as opt}
		<button
			type="button"
			onclick={() => (value = opt)}
			class="w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all"
			style={value === opt
				? `background-color: ${teamHex}25; border-color: ${teamHex};`
				: 'border-color: #3f3f46; background: transparent; color: #d4d4d8;'}
		>
			{opt}
		</button>
	{/each}
	<input type="hidden" {name} {value} />
</div>
