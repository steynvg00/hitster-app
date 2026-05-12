<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';

	interface Props {
		title: string;
		onclose: () => void;
		children: Snippet;
	}

	let { title, onclose, children }: Props = $props();

	let panel: HTMLDivElement;

	onMount(() => {
		panel?.focus();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
	onclick={(e) => {
		if (e.target === e.currentTarget) onclose();
	}}
>
	<div
		bind:this={panel}
		tabindex="-1"
		class="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl focus:outline-none"
	>
		<div class="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
			<h2 class="text-lg font-black text-white">{title}</h2>
			<button
				onclick={onclose}
				class="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
				aria-label="Close"
			>
				✕
			</button>
		</div>
		<div class="p-6">
			{@render children()}
		</div>
	</div>
</div>
