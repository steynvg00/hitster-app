<script lang="ts">
	import { Info } from 'lucide-svelte';

	let { text }: { text: string } = $props();

	let hovered = $state(false);
	let pinned = $state(false);
	let wrapper: HTMLSpanElement | undefined;

	const visible = $derived(hovered || pinned);

	function onClick(e: MouseEvent) {
		e.stopPropagation();
		pinned = !pinned;
	}

	function onWindowClick(e: MouseEvent) {
		if (pinned && wrapper && !wrapper.contains(e.target as Node)) {
			pinned = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') pinned = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<span bind:this={wrapper} class="relative inline-flex items-center align-middle">
	<button
		type="button"
		onclick={onClick}
		onmouseenter={() => (hovered = true)}
		onmouseleave={() => (hovered = false)}
		aria-label="Help: {text}"
		class="ml-1 inline-flex text-zinc-600 transition-colors hover:text-zinc-300 focus:text-zinc-300 focus:outline-none"
	>
		<Info size={14} />
	</button>
	{#if visible}
		<span
			role="tooltip"
			class="absolute top-full left-0 z-50 mt-1.5 w-56 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs leading-relaxed text-zinc-200 shadow-xl"
		>
			{text}
		</span>
	{/if}
</span>
