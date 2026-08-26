<script lang="ts">
	/**
	 * UITLEG-sheet (knop UITLEG op /team, en de "Hoe werkt het"-knop op de
	 * challengepagina).
	 *
	 * Vormtaal = die van de kaarten op /team: mixup-panel als paneelvulling,
	 * rounded-mixup-modal met squircle, glasrand rgba(229,242,255,0.18),
	 * font-display voor de kop, mixup-eyebrow voor labels en mixup-btn voor de
	 * knop. Tekst is Nederlands en je-vorm.
	 *
	 * De uitlegtekst zelf (`tutorial_text`) komt uit variant_defaults in de
	 * database — dit component vertaalt die niet, het toont hem alleen.
	 */
	interface Props {
		tutorials: Array<{ variant: string; tutorial_text: string | null }>;
		onclose: () => void;
		primaryLabel?: string;
	}

	let { tutorials, onclose, primaryLabel = 'Begrepen' }: Props = $props();

	/** Namen zoals de spelers ze op de kaarten zien. */
	const variantLabel: Record<string, string> = {
		standard: 'Hitster',
		anthem: 'Anthems',
		label: 'Icons',
		mashup: 'Mashups',
		fragments: 'Fragments',
		effects: 'Effects',
		normal: 'Normaal',
		vocal: 'Vocals',
		kick: 'Kicks',
		battle: 'Battle'
	};

	let expandedVariant = $state<string | null>(tutorials.length === 1 ? tutorials[0].variant : null);

	const title = $derived(
		tutorials.length === 1
			? (variantLabel[tutorials[0].variant] ?? tutorials[0].variant)
			: 'Hoe werkt het'
	);
</script>

<!-- Scrim: zelfde recept als de andere powerup-/uitlegoverlays. -->
<div
	class="fixed inset-0 z-50 flex items-end justify-center mixup-scrim"
	role="dialog"
	aria-modal="true"
	onclick={(e) => {
		if (e.target === e.currentTarget) onclose();
	}}
>
	<div class="sheet w-full max-w-lg squircle">
		<!-- Greep -->
		<div class="flex justify-center pt-3 pb-1">
			<div class="h-1 w-10 rounded-full bg-[rgba(229,242,255,0.28)]"></div>
		</div>

		<div class="px-5 pb-2">
			<div class="mixup-eyebrow">Uitleg</div>
			<h2
				class="mt-0.5 font-display text-[32px] leading-[0.95] font-black text-mixup-paper uppercase"
				style="text-shadow: 0 0 22px rgba(124,77,255,0.75);"
			>
				{title}
			</h2>
			{#if tutorials.length > 1}
				<p class="mt-1 text-xs font-medium text-mixup-dim">
					Tik op een challenge om de regels te zien
				</p>
			{/if}
		</div>

		<div class="max-h-[60dvh] space-y-2 overflow-y-auto px-5 pb-4">
			{#each tutorials as t (t.variant)}
				{@const label = variantLabel[t.variant] ?? t.variant}
				{#if tutorials.length === 1}
					<!-- Eén variant: tekst direct tonen -->
					<p class="text-sm leading-[1.55] font-medium text-mixup-soft">
						{t.tutorial_text ?? 'Voor deze challenge staat nog geen uitleg klaar.'}
					</p>
				{:else}
					<!-- Meerdere varianten: uitklapbare tegel -->
					<button
						type="button"
						onclick={() => {
							expandedVariant = expandedVariant === t.variant ? null : t.variant;
						}}
						class="tile w-full rounded-mixup-card px-4 py-3 text-left squircle"
						class:tile--on={expandedVariant === t.variant}
					>
						<div class="flex items-center justify-between gap-3">
							<span class="text-[13px] font-extrabold tracking-[0.08em] text-mixup-paper uppercase">
								{label}
							</span>
							<span class="text-xs text-mixup-dim">
								{expandedVariant === t.variant ? '▲' : '▼'}
							</span>
						</div>
						{#if expandedVariant === t.variant}
							<p class="mt-2 text-sm leading-[1.55] font-medium text-mixup-soft">
								{t.tutorial_text ?? 'Voor deze challenge staat nog geen uitleg klaar.'}
							</p>
						{/if}
					</button>
				{/if}
			{/each}
		</div>

		<div class="px-5 pb-6">
			<button type="button" onclick={onclose} class="sheet__cta mixup-btn w-full squircle">
				{primaryLabel}
			</button>
		</div>
	</div>
</div>

<style>
	/* Paneelvulling + rand van de /team-kaarten, met de safe-area-inset eronder
	   zodat de knop niet achter de iOS-browserbalk valt. */
	.sheet {
		background: linear-gradient(160deg, #1a1440 0%, #0e0b28 100%);
		border: 1px solid rgba(229, 242, 255, 0.18);
		border-bottom: 0;
		border-radius: var(--radius-mixup-modal) var(--radius-mixup-modal) 0 0;
		padding-bottom: env(safe-area-inset-bottom, 0px);
		box-shadow: 0 -18px 50px rgba(11, 11, 31, 0.65);
	}

	/* Zelfde glaskaart als .hub-card op /team. */
	.tile {
		background: linear-gradient(135deg, rgba(229, 242, 255, 0.1), rgba(229, 242, 255, 0.03));
		border: 1px solid rgba(229, 242, 255, 0.18);
		cursor: pointer;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.tile--on {
		border-color: var(--color-mixup-cyan);
		box-shadow: 0 0 18px rgba(0, 229, 255, 0.25);
	}

	/* Accentkleur van de primaire knop elders in de app (VERDER, Start de
	   challenge): geel -> oranje met dezelfde gloed. */
	.sheet__cta {
		background: linear-gradient(90deg, #ffe600, #ff7f11);
		color: #1a1400;
		box-shadow: 0 10px 30px rgba(255, 127, 17, 0.35);
	}
</style>
