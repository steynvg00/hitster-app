<script lang="ts">
	interface Props {
		name: string;
		placeholder?: string;
		teamHex?: string;
		value?: string;
	}

	let { name, placeholder = 'Type your answer…', teamHex = '#ef4444', value = $bindable('') }: Props =
		$props();
</script>

<input
	type="text"
	{name}
	bind:value
	{placeholder}
	autocomplete="off"
	class="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 transition-colors focus:outline-none"
	style={value ? `border-color: ${teamHex}` : ''}
/>
