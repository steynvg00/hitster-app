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
		placeholder = 'Typ om te zoeken…',
		teamHex = '#2E7BFF',
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
			? fuse
					.search(inputText)
					.map((r) => r.item)
					.slice(0, 8)
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
		class="mixup-input w-full rounded-mixup-sm squircle"
		style="--accent: {teamHex};{value ? ' border-color: var(--accent);' : ''}"
	/>
	<!-- Hidden input carries the confirmed value into the form -->
	<input type="hidden" {name} {value} />

	{#if open}
		<div
			class="absolute right-0 left-0 z-20 mt-1 max-h-52 overflow-y-auto rounded-mixup-sm shadow-xl mixup-glass-strong squircle"
			style="background: #14142e;"
		>
			{#if noMatches}
				<div class="px-4 py-3 text-sm text-mixup-dim italic">
					Geen treffers — check de spelling of vraag de host
				</div>
			{:else}
				{#each filtered as item}
					<button
						type="button"
						onclick={() => select(item)}
						class="w-full px-4 py-2.5 text-left text-sm text-mixup-paper transition-colors hover:bg-mixup-paper/10"
					>
						{item}
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	{#if value === '' && inputText.length > 0 && !noMatches}
		<p class="mt-1 text-xs text-mixup-dim">Kies een optie uit de lijst</p>
	{/if}
</div>

<style>
	.mixup-input {
		background: rgba(11, 11, 31, 0.62);
		border: 1px solid rgba(229, 242, 255, 0.22);
		padding: 13px 14px;
		color: var(--color-mixup-paper);
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 16px;
		transition:
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}
	/* @tailwindcss/forms zet op :focus een 1px blue-600 ring (box-shadow) plus een
	   blauwe border — de browser-blauwe rechthoek uit de toesteltest. Hier
	   vervangen door een ring in de teamkleur op :focus-visible; box-shadow volgt
	   de border-radius/squircle van het veld zelf. outline gaat pas uit als de
	   ring er is, zodat toetsenbord-focus zichtbaar blijft. */
	.mixup-input:focus {
		box-shadow: none;
		border-color: rgba(229, 242, 255, 0.22);
	}
	.mixup-input:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 32%, transparent);
	}
	.mixup-input::placeholder {
		color: var(--color-mixup-dim);
	}
</style>
