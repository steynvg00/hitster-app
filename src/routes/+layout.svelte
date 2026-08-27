<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Toast from '$lib/components/ui/Toast.svelte';
	import DevNav from '$lib/components/DevNav.svelte';
	import LayerProbe from '$lib/components/LayerProbe.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<!-- De enige scroller van de app: html en body staan vast op de viewporthoogte.
     Zonder vensterscroll kan een `position: fixed` achtergrondlaag op iOS niet
     meer losraken van de viewport — zie het blok bij html/body in layout.css.
     Toast, LayerProbe en DevNav staan er BUITEN; die zijn zelf fixed en horen
     niet mee te scrollen. -->
<div class="app-scroll">
	{@render children()}
</div>

<Toast />
<!-- Diagnose op het toestel: rendert alleen met ?probe=laag in de URL.
     Leest uitsluitend viewportmaten en berekende CSS. Zie het component. -->
<LayerProbe />
{#if import.meta.env.DEV}
	<DevNav />
{/if}
