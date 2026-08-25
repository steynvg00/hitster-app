<script lang="ts">
	// Shared multi-artist tag input — ONE component for all three surfaces so they
	// can't drift: the admin track editor (T1), the player's artist answer field
	// (C1 stuk 2), and any future artist list.
	//
	// Produces/consumes a plain string[]. The caller owns serialisation — the
	// player joins with joinArtistTags ($lib/artist-tags) to hit the scorer's wire
	// format; the track editor stores the array straight into tracks.artists[].
	//
	// `pool` drives suggestions. Pass an EMPTY pool to get a suggestion-free input:
	// that's not a detail, it's the difficulty model. An open_text artist field is
	// meant to be answered from memory, so surfacing the answer-pool names there
	// would hand the answer over. Only combobox mode (which is pool-backed by
	// definition) passes a pool.

	import Fuse from 'fuse.js';
	import { joinArtistTags } from '$lib/artist-tags';

	let {
		tags = $bindable<string[]>([]),
		pool = [],
		placeholder = 'Type a name, Enter to add…',
		accentHex = '#f59e0b',
		maxTags = 0,
		disabled = false,
		name = ''
	}: {
		tags?: string[];
		/** Suggestion source. Empty = no suggestions (open_text). */
		pool?: string[];
		placeholder?: string;
		/** Team colour on the player side, amber in admin. */
		accentHex?: string;
		/** 0 = unlimited. */
		maxTags?: number;
		disabled?: boolean;
		/**
		 * When set, mirrors the tags into a hidden input as the '\n'-joined wire
		 * value — the same shape Combobox/MultipleChoice use to expose themselves to
		 * a form. Also what makes the control findable by name: the bot harness
		 * resolves every answer control via input[name=…], so without this the artist
		 * field is invisible to it and the ace silently scores 0 on artist.
		 * The data-tag-input marker is how the harness tells this apart from a
		 * combobox (which also pairs a hidden input with a visible text box).
		 */
		name?: string;
	} = $props();

	let query = $state('');
	const wireValue = $derived(joinArtistTags(tags));

	const fuse = $derived(new Fuse(pool, { threshold: 0.4, minMatchCharLength: 1 }));
	const atLimit = $derived(maxTags > 0 && tags.length >= maxTags);

	const suggestions = $derived(
		pool.length > 0 && query.trim().length > 0 && !atLimit
			? fuse
					.search(query)
					.map((r) => r.item)
					.filter((n) => !tags.some((t) => t.toLowerCase() === n.toLowerCase()))
					.slice(0, 6)
			: []
	);

	function add(name: string) {
		const trimmed = name.trim();
		if (!trimmed || atLimit) return;
		// Case-insensitive dedupe — "ran-d" and "Ran-D" are the same artist, and a
		// duplicate tag would only burn itself against the scorer's one-tag-per-
		// target rule while counting toward the over-guess surplus.
		if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
			query = '';
			return;
		}
		tags = [...tags, trimmed];
		query = '';
	}

	function remove(name: string) {
		tags = tags.filter((t) => t !== name);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			// Enter must never submit the surrounding form from this input.
			e.preventDefault();
			add(query);
		} else if (e.key === 'Backspace' && query === '' && tags.length > 0) {
			tags = tags.slice(0, -1);
		}
	}
</script>

<!--
	The box is deliberately token-for-token the same treatment as OpenText/Combobox
	(rounded-xl / border-zinc-700 / bg-zinc-900, solid accent border once filled,
	min-h matching their px-4 py-3 height) — on the challenge page this sits in a
	column of answer fields, and a shorter, thinner-bordered box next to Title read
	as a search bar rather than an answer field. min-h keeps the height stable as
	pills come and go instead of the box growing from a search-bar sliver.
-->
<div
	class="tag-box flex min-h-[3.125rem] flex-wrap items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-2 transition-colors"
	style="--accent: {accentHex};{tags.length > 0 ? ' border-color: var(--accent);' : ''}"
>
	{#if name}
		<input type="hidden" {name} value={wireValue} data-tag-input="true" />
	{/if}

	{#each tags as tag (tag)}
		<span
			class="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold"
			style="background: {accentHex}22; color: {accentHex};"
		>
			{tag}
			{#if !disabled}
				<button
					type="button"
					onclick={() => remove(tag)}
					class="leading-none opacity-60 transition-opacity hover:opacity-100"
					aria-label={`Remove ${tag}`}
				>
					✕
				</button>
			{/if}
		</span>
	{/each}

	{#if !disabled && !atLimit}
		<div class="relative min-w-[9rem] flex-1">
			<!--
				border-0 is load-bearing, not tidying. layout.css loads
				@plugin '@tailwindcss/forms', which gives every bare <input type="text"> a
				1px gray-500 border. OpenText/Combobox only avoid it because they declare
				their own `border border-zinc-700`; this input declares none, so the
				plugin's default rendered a second box INSIDE the container — the visible
				"search bar" line. It also cost 2px of height, which is why the container
				measured 52px against Title's 50px.
			-->
			<input
				type="text"
				bind:value={query}
				onkeydown={onKeydown}
				{placeholder}
				autocomplete="off"
				class="tag-input w-full border-0 bg-transparent px-2 py-1 text-zinc-100"
			/>
			{#if suggestions.length > 0}
				<div
					class="absolute left-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl"
				>
					{#each suggestions as s (s)}
						<button
							type="button"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => add(s)}
							class="block w-full px-3 py-2 text-left text-xs text-zinc-200 transition-colors hover:bg-zinc-700"
						>
							{s}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* @tailwindcss/forms zet op :focus van het binnenste tekstveld een 1px
	   blue-600 ring (box-shadow) — een blauwe rechthoek IN de afgeronde pil-box.
	   Die gaat hier uit; de focusring zit op de box zelf, in de accentkleur, en
	   volgt zo de rounded-xl van de box. :has(:focus-visible) houdt de ring
	   zichtbaar voor toetsenbord- én touch-focus op het tekstveld. */
	.tag-input:focus,
	.tag-input:focus-visible {
		outline: none;
		box-shadow: none;
		border-color: transparent;
	}
	.tag-box:has(.tag-input:focus-visible) {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 32%, transparent);
	}
</style>
