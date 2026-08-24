<script lang="ts">
	/**
	 * Vrij tekstveld (redesign fase 3, scherm 7B).
	 *
	 * Designwaardes: achtergrond rgba(11,11,31,0.62), rand
	 * rgba(229,242,255,0.22), radius 16 squircle, padding 13px 14px, Rubik 500.
	 * De rand neemt de teamkleur over zodra er iets staat.
	 *
	 * Font-size is 16px, niet de 15px uit de designbron: onder 16px zoomt iOS
	 * Safari bij focus in op het veld, en dat is midden in een lopende timer een
	 * echte hindernis. Dezelfde afweging als bij het naamveld op de onboarding.
	 */
	interface Props {
		name: string;
		placeholder?: string;
		teamHex?: string;
		value?: string;
	}

	let {
		name,
		placeholder = 'Typ je antwoord…',
		teamHex = '#2E7BFF',
		value = $bindable('')
	}: Props = $props();
</script>

<input
	type="text"
	{name}
	bind:value
	{placeholder}
	autocomplete="off"
	class="mixup-input w-full rounded-mixup-sm squircle"
	style={value ? `border-color: ${teamHex};` : ''}
/>

<style>
	.mixup-input {
		background: rgba(11, 11, 31, 0.62);
		border: 1px solid rgba(229, 242, 255, 0.22);
		padding: 13px 14px;
		color: var(--color-mixup-paper);
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 16px;
		outline: none;
		transition: border-color 0.18s ease;
	}
	.mixup-input::placeholder {
		color: var(--color-mixup-dim);
	}
</style>
