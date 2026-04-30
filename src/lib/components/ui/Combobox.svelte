<script lang="ts">
	import Fuse from 'fuse.js';

	interface Props {
		name: string;
		pool: string[];
		placeholder?: string;
		teamHex?: string;
		value?: string;
	}

	let {
		name,
		pool,
		placeholder = 'Type to search…',
		teamHex = '#ef4444',
		value = $bindable('')
	}: Props = $props();

	let inputText = $state(value || '');
	let open = $state(false);

	const fuse = $derived(new Fuse(pool, { threshold: 0.4, minMatchCharLength: 1 }));

	const filtered = $derived(
		inputText.length >= 1
			? fuse.search(inputText).map((r) => r.item).slice(0, 8)
			: pool.slice(0, 8)
	);

	const noMatches = $derived(inputText.length > 0 && filtered.length === 0);

	function select(item: string) {
		inputText = item;
		value = item;
		open = false;
	}

	function handleInput() {
		open = true;
		// Confirm value only on exact (case-insensitive) pool match
		const exact = pool.find((p) => p.toLowerCase() === inputText.toLowerCase());
		value = exact ?? '';
	}

	function handleBlur() {
		// Delay close to allow click on dropdown option to fire first
		setTimeout(() => {
			open = false;
		}, 150);
	}
</script>

<div class="relative">
	<input
		type="text"
		bind:value={inputText}
		oninput={handleInput}
		onfocus={() => (open = true)}
		onblur={handleBlur}
		{placeholder}
		autocomplete="off"
		class="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 transition-colors focus:outline-none"
		style="border-color: {value ? teamHex : ''}"
	/>
	<!-- Hidden input carries the confirmed value into the form -->
	<input type="hidden" {name} value={value} />

	{#if open}
		<div
			class="absolute left-0 right-0 z-20 mt-1 max-h-52 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-800 shadow-xl"
		>
			{#if noMatches}
				<div class="px-4 py-3 text-sm italic text-zinc-500">
					No matches — check spelling or ask the host
				</div>
			{:else}
				{#each filtered as item}
					<button
						type="button"
						onclick={() => select(item)}
						class="w-full px-4 py-2.5 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-700"
					>
						{item}
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	{#if value === '' && inputText.length > 0 && !noMatches}
		<p class="mt-1 text-xs text-zinc-500">Select an option from the list</p>
	{/if}
</div>
