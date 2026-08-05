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

	// The visible text and the confirmed `value` are deliberately two different
	// things: you can type "master" (no confirmed value yet) and only picking an
	// option from the list commits it. That split is why `inputText` starts as a
	// COPY of `value` rather than being bound to it.
	//
	// A copy taken once at mount, though, is a one-way street — and a powerup reveal
	// writes the answer into the draft this component is bound to, from the outside,
	// while it is mounted. `value` updated, the hidden input carried the right
	// answer, the "Revealed:" badge showed it, and the box the player actually looks
	// at stayed empty. (Cross-tab reveals looked fine, because switching tabs
	// remounts the inputs via {#key activeTabIndex} — which is the same thing said
	// twice: a fresh mount re-copies the value.)
	//
	// So the copy is kept in sync with EXTERNAL writes only. `selfValue` mirrors the
	// last value this component itself produced; when `value` differs from it, the
	// change came from somewhere else and the text must follow. Without that guard
	// the sync would fight the player's typing, because handleInput() sets
	// `value = ''` on every keystroke that isn't an exact pool match.
	let inputText = $state(value || '');
	let selfValue = $state(value);
	let open = $state(false);

	$effect(() => {
		if (value === selfValue) return; // our own write — already on screen
		selfValue = value;
		// Follows an external clear too, which is what a multi-source tab needs when
		// the player switches answer slot: the binding re-points at another slot's
		// value without a remount, so a stale label would otherwise sit above the
		// wrong track.
		inputText = value;
	});

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
		selfValue = item; // ours, not an external write — keeps the sync effect quiet
		open = false;
	}

	function handleInput() {
		open = true;
		// Confirm value only on exact (case-insensitive) pool match
		const exact = pool.find((p) => p.toLowerCase() === inputText.toLowerCase());
		value = exact ?? '';
		selfValue = value; // ditto: never let the sync effect overwrite live typing
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
