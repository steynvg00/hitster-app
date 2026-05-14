<script module lang="ts">
	// Module-level cache: one MediaElementAudioSourceNode per HTMLAudioElement.
	// The Web Audio API forbids creating a second source for the same element —
	// this prevents the InvalidStateError that occurs when applyEffects runs
	// concurrently (e.g. from both the WaveSurfer 'ready' callback and the
	// reactive $effect that fires when isReady becomes true).
	const mediaElementSourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

	function getOrCreateMediaElementSource(
		audioEl: HTMLAudioElement,
		ctx: AudioContext
	): MediaElementAudioSourceNode {
		let source = mediaElementSourceCache.get(audioEl);
		if (!source) {
			source = ctx.createMediaElementSource(audioEl);
			mediaElementSourceCache.set(audioEl, source);
		}
		return source;
	}
</script>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	export interface ClipEffects {
		pitch?: number; // semitones, -12 to +12
		tempo?: number; // multiplier, 0.5 to 2.0
	}

	interface Props {
		src: string;
		height?: number;
		progressColor?: string;
		waveColor?: string;
		effects?: ClipEffects;
		onPlayStateChange?: (isPlaying: boolean) => void;
		onTimeUpdate?: (currentTime: number, duration: number) => void;
	}

	let {
		src,
		height = 48,
		progressColor = '#fbbf24',
		waveColor = '#3f3f46',
		effects,
		onPlayStateChange,
		onTimeUpdate
	}: Props = $props();

	let container: HTMLElement;
	let ws: import('wavesurfer.js').default | null = null;
	let isReady = $state(false);

	// Tone.js nodes — created lazily when effects are applied
	let toneSourceNode: MediaElementAudioSourceNode | null = null;
	let tonePitchShift: import('tone').PitchShift | null = null;

	export function playPause() {
		ws?.playPause();
	}
	export function pause() {
		ws?.pause();
	}
	export function getIsPlaying(): boolean {
		return ws?.isPlaying() ?? false;
	}

	// Apply effects to the Tone.js chain whenever effects prop changes
	$effect(() => {
		if (!isReady || !ws) return;
		applyEffects(effects);
	});

	async function applyEffects(fx: ClipEffects | undefined) {
		const pitch = fx?.pitch ?? 0;
		const tempo = fx?.tempo ?? 1;
		const hasEffects = pitch !== 0 || tempo !== 1;

		const mediaEl = ws?.getMediaElement();
		if (!mediaEl) return;

		if (!hasEffects) {
			// Reset to defaults — clean up Tone.js chain if set up
			mediaEl.playbackRate = 1;
			if (tonePitchShift) {
				tonePitchShift.pitch = 0;
			}
			return;
		}

		const Tone = await import('tone');
		await Tone.start();
		const ctx = Tone.context.rawContext as AudioContext;

		// Retrieve or create the cached source node (never call createMediaElementSource twice)
		const source = getOrCreateMediaElementSource(mediaEl as HTMLAudioElement, ctx);

		if (!tonePitchShift) {
			tonePitchShift = new Tone.PitchShift();
			tonePitchShift.toDestination();
		}

		// Disconnect before re-wiring so stale connections don't persist
		source.disconnect();
		source.connect(tonePitchShift.input as unknown as AudioNode);
		toneSourceNode = source;

		// tempo changes pitch by log2(tempo)*12 semitones; correct for it
		const tempoCorrection = -Math.log2(tempo) * 12;
		mediaEl.playbackRate = tempo;
		tonePitchShift.pitch = pitch + tempoCorrection;
	}

	onMount(() => {
		import('wavesurfer.js').then(({ default: WaveSurfer }) => {
			const mediaEl = document.createElement('audio');
			mediaEl.crossOrigin = 'anonymous';
			ws = WaveSurfer.create({
				container,
				media: mediaEl,
				waveColor,
				progressColor,
				height,
				normalize: true,
				interact: true,
				hideScrollbar: true,
				url: src
			});

			ws.on('ready', () => {
				isReady = true;
				// Apply any initial effects
				applyEffects(effects);
			});
			ws.on('play', () => onPlayStateChange?.(true));
			ws.on('pause', () => onPlayStateChange?.(false));
			ws.on('finish', () => onPlayStateChange?.(false));
			ws.on('timeupdate', (t: number) => onTimeUpdate?.(t, ws?.getDuration() ?? 0));
		});
	});

	onDestroy(() => {
		tonePitchShift?.dispose();
		tonePitchShift = null;
		toneSourceNode?.disconnect();
		toneSourceNode = null;
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
