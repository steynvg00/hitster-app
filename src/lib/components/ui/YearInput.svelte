<script lang="ts">
	/**
	 * Jaar-invoer (redesign fase 3, scherm 7B).
	 *
	 * De designbron toont het jaar als een rij chips in de teamkleur; die vorm
	 * is de `multiple_choice`-modus (zie MultipleChoice, layout="chips"). Deze
	 * component dekt de twee numerieke modi:
	 *
	 *   slider          — groot jaartal in de teamkleur + een range in dezelfde kleur
	 *   typeable_number — −/+ knoppen (44px hit target) rond een getalveld
	 *
	 * De teamkleur draagt in beide modi, net als de actieve tab en de play-knop.
	 */
	interface Props {
		name: string;
		mode?: 'slider' | 'typeable_number';
		teamHex?: string;
		min?: number;
		max?: number;
		value?: number;
		/**
		 * Fired when the TEAM actually operates this input (drag, type, ± button).
		 * A year field always holds a number, so a caller tracking "did they answer
		 * this?" cannot derive it from the value — and must not, because the browser
		 * itself rewrites an out-of-range initial value (it clamps to `min`, which
		 * Svelte's binding then writes back during hydration). A real DOM event
		 * fires for none of that, which is exactly why the signal lives here.
		 */
		ontouched?: () => void;
	}

	let {
		name,
		mode = 'slider',
		teamHex = '#2E7BFF',
		// 1990, was 2000. De ondergrens is HARDCODED en wordt nergens uit de tracks
		// afgeleid: geen enkele callsite geeft `min` mee, dus dit getal is de enige
		// ondergrens die de speler te zien krijgt. Er stond een track van 1995 in de
		// bibliotheek (Paul Elstak — Rainbow in the Sky) die daardoor niet te kiezen
		// was; de admin-kant liet hem wél toe (min="1950" op /admin/tracks).
		//
		// 1990 met vijf jaar marge onder het werkelijke minimum van de bibliotheek.
		min = 1990,
		max = 2026,
		value = $bindable(2013),
		ontouched
	}: Props = $props();
</script>

<div>
	{#if mode === 'slider'}
		<div
			class="mb-2 text-center font-display text-6xl leading-none font-black tabular-nums"
			style="color: {teamHex}; text-shadow: 0 0 26px {teamHex}66;"
		>
			{value}
		</div>
		<input
			type="range"
			{name}
			{min}
			{max}
			bind:value
			oninput={() => ontouched?.()}
			class="w-full"
			style="accent-color: {teamHex};"
		/>
		<div class="mt-1 flex justify-between font-data text-[11px] text-mixup-dim">
			<span>{min}</span>
			<span>{max}</span>
		</div>
	{:else}
		<div class="flex items-center gap-3">
			<button
				type="button"
				aria-label="Jaar omlaag"
				onclick={() => {
					value = Math.max(min, value - 1);
					ontouched?.();
				}}
				class="mixup-step flex h-11 w-11 shrink-0 items-center justify-center rounded-mixup-sm text-xl squircle"
			>
				−
			</button>
			<input
				type="number"
				{name}
				bind:value
				oninput={() => ontouched?.()}
				{min}
				{max}
				class="mixup-year flex-1 rounded-mixup-sm text-center tabular-nums squircle"
				style="color: {teamHex}; --accent: {teamHex};"
			/>
			<button
				type="button"
				aria-label="Jaar omhoog"
				onclick={() => {
					value = Math.min(max, value + 1);
					ontouched?.();
				}}
				class="mixup-step flex h-11 w-11 shrink-0 items-center justify-center rounded-mixup-sm text-xl squircle"
			>
				+
			</button>
		</div>
	{/if}
</div>

<style>
	.mixup-step {
		background: rgba(229, 242, 255, 0.05);
		border: 1px solid rgba(229, 242, 255, 0.16);
		color: var(--color-mixup-muted);
		transition: color 0.18s ease;
	}
	.mixup-step:hover {
		color: var(--color-mixup-paper);
	}

	.mixup-year {
		background: rgba(11, 11, 31, 0.62);
		border: 1px solid rgba(229, 242, 255, 0.22);
		padding: 10px 14px;
		font-family: var(--font-display);
		font-weight: 900;
		font-size: 30px;
		line-height: 1;
		transition:
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}
	/* @tailwindcss/forms zet op :focus een 1px blue-600 ring (box-shadow) plus een
	   blauwe border — de browser-blauwe rechthoek uit de toesteltest. Hier
	   vervangen door een ring in de teamkleur op :focus-visible; box-shadow volgt
	   de border-radius/squircle van het veld zelf. outline gaat pas uit als de
	   ring er is, zodat toetsenbord-focus zichtbaar blijft. */
	.mixup-year:focus {
		box-shadow: none;
		border-color: rgba(229, 242, 255, 0.22);
	}
	.mixup-year:focus-visible {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 32%, transparent);
	}
</style>
