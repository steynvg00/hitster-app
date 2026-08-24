<script lang="ts">
	/**
	 * Meerkeuze-antwoord.
	 *
	 * Twee layouts (redesign fase 3):
	 *   list  — verticale knoppen, voor lange opties (titel, artiest, label)
	 *   chips — horizontaal wrappende chips, de "jaarchips" uit designscherm 7B
	 *
	 * De gekozen optie neemt in beide layouts de TEAMKLEUR over, met een gloed
	 * eronder — zoals de actieve tab en de play-knop op hetzelfde scherm.
	 */
	interface Props {
		name: string;
		options: string[];
		teamHex?: string;
		/** Leesbare tekstkleur op een vlak in de teamkleur (zie $lib/team-theme). */
		onColor?: string;
		layout?: 'list' | 'chips';
		value?: string;
	}

	let {
		name,
		options,
		teamHex = '#2E7BFF',
		onColor = '#FFFFFF',
		layout = 'list',
		value = $bindable('')
	}: Props = $props();

	const selectedStyle = $derived(
		`background: ${teamHex}; color: ${onColor}; border: 1px solid ${teamHex}; box-shadow: 0 0 18px ${teamHex}80;`
	);
	const idleStyle =
		'background: rgba(229,242,255,0.05); color: #9FB1D9; border: 1px solid rgba(229,242,255,0.16);';
</script>

{#if layout === 'chips'}
	<div class="flex flex-wrap gap-2">
		{#each options as opt (opt)}
			<button
				type="button"
				onclick={() => (value = opt)}
				aria-pressed={value === opt}
				class="inline-flex min-h-[44px] items-center gap-1.5 rounded-mixup-chip px-[9px] py-[11px] text-xs font-extrabold tracking-[0.04em] whitespace-nowrap transition-all squircle"
				style={value === opt ? selectedStyle : idleStyle}
			>
				{opt}
			</button>
		{/each}
		<input type="hidden" {name} {value} />
	</div>
{:else}
	<div class="grid gap-2">
		{#each options as opt (opt)}
			<button
				type="button"
				onclick={() => (value = opt)}
				aria-pressed={value === opt}
				class="w-full rounded-mixup-sm px-4 py-3 text-left text-sm font-medium transition-all squircle"
				style={value === opt ? selectedStyle : idleStyle}
			>
				{opt}
			</button>
		{/each}
		<input type="hidden" {name} {value} />
	</div>
{/if}
