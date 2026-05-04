<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		src: string;
		height?: number;
		progressColor?: string;
		waveColor?: string;
		onPlayStateChange?: (isPlaying: boolean) => void;
		onTimeUpdate?: (currentTime: number, duration: number) => void;
	}

	let {
		src,
		height = 48,
		progressColor = '#fbbf24',
		waveColor = '#3f3f46',
		onPlayStateChange,
		onTimeUpdate
	}: Props = $props();

	let container: HTMLElement;
	let ws: import('wavesurfer.js').default | null = null;
	let isReady = $state(false);

	export function playPause() {
		ws?.playPause();
	}
	export function pause() {
		ws?.pause();
	}
	export function getIsPlaying(): boolean {
		return ws?.isPlaying() ?? false;
	}

	onMount(() => {
		import('wavesurfer.js').then(({ default: WaveSurfer }) => {
			ws = WaveSurfer.create({
				container,
				waveColor,
				progressColor,
				height,
				normalize: true,
				interact: true,
				hideScrollbar: true,
				url: src
			});

			ws.on('ready', () => (isReady = true));
			ws.on('play', () => onPlayStateChange?.(true));
			ws.on('pause', () => onPlayStateChange?.(false));
			ws.on('finish', () => onPlayStateChange?.(false));
			ws.on('timeupdate', (t: number) => onTimeUpdate?.(t, ws?.getDuration() ?? 0));
		});
	});

	onDestroy(() => {
		ws?.destroy();
		ws = null;
	});
</script>

<div class="relative w-full" style="min-height: {height}px;">
	{#if !isReady}
		<div
			class="absolute inset-0 animate-pulse rounded"
			style="height: {height}px; background-color: {waveColor}; opacity: 0.4;"
		></div>
	{/if}
	<div bind:this={container} class="w-full"></div>
</div>
