<script lang="ts">
	/**
	 * M!XUP glaskaart.
	 *
	 * Dunne wrapper om de `mixup-glass*` utilities uit src/routes/layout.css:
	 * rgba(229,242,255,0.04) achtergrond, 1px rand (0.12 / 0.14 / 0.22) en
	 * backdrop-filter: blur(14px), met squircle-hoeken waar de browser die
	 * ondersteunt.
	 *
	 * Voor eenmalig gebruik kun je net zo goed de utility direct pakken:
	 *   <div class="mixup-glass squircle rounded-mixup-card p-4">…</div>
	 *
	 * Props:
	 *   radius  — chip (14) | sm (16) | card (20, default) | lg (22) | modal (26) | hero (28)
	 *   border  — soft (0.12) | default (0.14) | strong (0.22)
	 *   element — wrapper-tag (default 'div'; 'section', 'article', … mag ook)
	 *   class   — extra classes (padding, layout, glow, …)
	 */
	import type { Snippet } from 'svelte';

	type Radius = 'chip' | 'sm' | 'card' | 'lg' | 'modal' | 'hero';
	type Border = 'soft' | 'default' | 'strong';

	type Props = {
		radius?: Radius;
		border?: Border;
		element?: keyof HTMLElementTagNameMap;
		class?: string;
		children?: Snippet;
	};

	let {
		radius = 'card',
		border = 'default',
		element = 'div',
		class: className = '',
		children
	}: Props = $props();

	const RADIUS_CLASS: Record<Radius, string> = {
		chip: 'rounded-mixup-chip',
		sm: 'rounded-mixup-sm',
		card: 'rounded-mixup-card',
		lg: 'rounded-mixup-lg',
		modal: 'rounded-mixup-modal',
		hero: 'rounded-mixup-hero'
	};

	const BORDER_CLASS: Record<Border, string> = {
		soft: 'mixup-glass-soft',
		default: 'mixup-glass',
		strong: 'mixup-glass-strong'
	};

	let classes = $derived(
		`${BORDER_CLASS[border]} squircle ${RADIUS_CLASS[radius]} ${className}`.trim()
	);
</script>

<svelte:element this={element} class={classes}>
	{@render children?.()}
</svelte:element>
