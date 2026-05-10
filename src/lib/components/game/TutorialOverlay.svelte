<script lang="ts">
	interface Props {
		tutorials: Array<{ variant: string; tutorial_text: string | null }>;
		onclose: () => void;
		primaryLabel?: string;
	}

	let { tutorials, onclose, primaryLabel = 'Got it' }: Props = $props();

	const variantLabel: Record<string, string> = {
		normal: 'Normal', label: 'Label', anthem: 'Anthem', vocal: 'Vocal',
		fragments: 'Fragments', kick: 'Kick', mashup: 'Mashup', battle: 'Battle'
	};

	let expandedVariant = $state<string | null>(tutorials.length === 1 ? tutorials[0].variant : null);
</script>

<!-- Overlay backdrop -->
<div
	class="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
	role="dialog"
	aria-modal="true"
	onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
>
	<div class="w-full max-w-lg rounded-t-2xl bg-zinc-900 border border-zinc-800 pb-safe">
		<!-- Handle -->
		<div class="flex justify-center pt-3 pb-1">
			<div class="h-1 w-10 rounded-full bg-zinc-700"></div>
		</div>

		<div class="px-5 pb-2">
			<h2 class="text-lg font-black text-white">
				{tutorials.length === 1
					? `${variantLabel[tutorials[0].variant] ?? tutorials[0].variant} — How to play`
					: 'How to play'}
			</h2>
			{#if tutorials.length > 1}
				<p class="mt-0.5 text-xs text-zinc-500">Tap a variant to see its rules</p>
			{/if}
		</div>

		<div class="px-5 pb-4 space-y-2 max-h-[60vh] overflow-y-auto">
			{#each tutorials as t}
				{@const label = variantLabel[t.variant] ?? t.variant}
				{#if tutorials.length === 1}
					<!-- Single variant: show text directly -->
					<p class="text-sm text-zinc-300 leading-relaxed">
						{t.tutorial_text ?? 'No tutorial text set for this variant yet.'}
					</p>
				{:else}
					<!-- Multi-variant: expandable tile -->
					<button
						type="button"
						onclick={() => { expandedVariant = expandedVariant === t.variant ? null : t.variant; }}
						class="w-full text-left rounded-xl border px-4 py-3 transition-colors
							{expandedVariant === t.variant
								? 'border-amber-500/50 bg-amber-950/30'
								: 'border-zinc-800 bg-zinc-800/50 hover:border-zinc-700'}"
					>
						<div class="flex items-center justify-between">
							<span class="font-semibold text-white capitalize">{label}</span>
							<span class="text-zinc-500 text-sm">{expandedVariant === t.variant ? '▲' : '▼'}</span>
						</div>
						{#if expandedVariant === t.variant}
							<p class="mt-2 text-sm text-zinc-300 leading-relaxed">
								{t.tutorial_text ?? 'No tutorial text set for this variant yet.'}
							</p>
						{/if}
					</button>
				{/if}
			{/each}
		</div>

		<div class="px-5 pb-6">
			<button
				type="button"
				onclick={onclose}
				class="w-full rounded-xl bg-amber-400 py-3 text-sm font-bold text-zinc-950 hover:bg-amber-300 transition-colors"
			>
				{primaryLabel}
			</button>
		</div>
	</div>
</div>
