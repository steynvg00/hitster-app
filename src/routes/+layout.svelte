<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Toast from '$lib/components/ui/Toast.svelte';
	import DevNav from '$lib/components/DevNav.svelte';
	import LayerProbe from '$lib/components/LayerProbe.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
<Toast />
<!-- Diagnose op het toestel: rendert alleen met ?probe=laag in de URL.
     Leest uitsluitend viewportmaten en berekende CSS. Zie het component. -->
<LayerProbe />
{#if import.meta.env.DEV}
	<DevNav />
{/if}
