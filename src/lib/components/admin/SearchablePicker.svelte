<script lang="ts">
	import Fuse from 'fuse.js';

	type Item = { id: string; label: string; subtitle?: string };

	let {
		name,
		items,
		value = $bindable(''),
		placeholder = 'Search…',
		emptyLabel = '— none —'
	}: {
		name: string;
		items: Item[];
		value?: string;
		placeholder?: string;
		emptyLabel?: string;
	} = $props();

	let query = $state('');
	let open = $state(false);
	let containerEl = $state<HTMLDivElement | undefined>(undefined);

	const fuse = $derived(
		new Fuse(items, { keys: ['label', 'subtitle'], threshold: 0.4, includeScore: true })
	);

	const results = $derived(
		query.trim() ? fuse.search(query).map((r) => r.item) : items.slice(0, 12)
	);

	const selectedItem = $derived(items.find((i) => i.id === value));

	function select(id: string, el: HTMLElement) {
		value = id;
		query = '';
		open = false;
		// submit the closest form
		const form = el.closest('form');
		form?.requestSubmit();
	}

	function onFocusOut(e: FocusEvent) {
		if (!containerEl?.contains(e.relatedTarget as Node)) {
			open = false;
			query = '';
		}
	}
</script>

<div class="relative" bind:this={containerEl} onfocusout={onFocusOut} role="none">
	<input type="hidden" {name} {value} />

	<!-- Trigger / search input -->
	<input
		type="text"
		class="input-field w-full cursor-text pr-6"
		placeholder={selectedItem ? selectedItem.label : placeholder}
		bind:value={query}
		onfocus={() => (open = true)}
		oninput={() => (open = true)}
		autocomplete="off"
	/>
	{#if value}
		<button
			type="button"
			class="absolute top-1/2 right-2 -translate-y-1/2 text-zinc-500 hover:text-white"
			onclick={(e) => select('', e.currentTarget)}
			tabindex="-1">✕</button
		>
	{/if}

	{#if open}
		<ul
			class="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
		>
			<!-- Empty / clear option -->
			<li>
				<button
					type="button"
					class="w-full px-3 py-2 text-left text-xs text-zinc-500 hover:bg-zinc-800"
					onclick={(e) => select('', e.currentTarget)}>{emptyLabel}</button
				>
			</li>
			{#each results as item (item.id)}
				<li>
					<button
						type="button"
						class="flex w-full flex-col px-3 py-2 text-left hover:bg-zinc-800 {value === item.id
							? 'bg-zinc-800'
							: ''}"
						onclick={(e) => select(item.id, e.currentTarget)}
					>
						<span class="text-xs text-zinc-200">{item.label}</span>
						{#if item.subtitle}
							<span class="text-[10px] text-zinc-500">{item.subtitle}</span>
						{/if}
					</button>
				</li>
			{/each}
			{#if results.length === 0}
				<li class="px-3 py-2 text-xs text-zinc-600 italic">No matches</li>
			{/if}
		</ul>
	{/if}
</div>
