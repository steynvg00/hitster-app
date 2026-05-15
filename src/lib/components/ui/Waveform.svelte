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
	import type { EffectsConfig } from '$lib/types/index.js';

	interface Props {
		src: string;
		height?: number;
		progressColor?: string;
		waveColor?: string;
		effects?: EffectsConfig | null;
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

	// Stored AudioContext — set when the Web Audio chain is first established.
	// Accessed synchronously in playPause() so the user gesture can resume it.
	let audioCtx: AudioContext | null = null;

	// Tone.js nodes
	let toneSourceNode: MediaElementAudioSourceNode | null = null;
	let tonePitchShift: import('tone').PitchShift | null = null;
	let tonePhaser: import('tone').Phaser | null = null;
	let toneLowpass: import('tone').Filter | null = null;
	let toneHighpass: import('tone').Filter | null = null;
	let toneBandpass: import('tone').Filter | null = null;

	// Generation counter: incremented on every applyEffects call.
	// Async awaits yield control; if a newer call has taken over, the stale
	// call bails instead of connecting half-disposed nodes.
	let applyEffectsGeneration = 0;

	function disposeToneNodes() {
		tonePitchShift?.dispose();
		tonePitchShift = null;
		tonePhaser?.dispose();
		tonePhaser = null;
		toneLowpass?.dispose();
		toneLowpass = null;
		toneHighpass?.dispose();
		toneHighpass = null;
		toneBandpass?.dispose();
		toneBandpass = null;
	}

	export function playPause() {
		// Resume AudioContext synchronously from user gesture.
		// iOS/Safari keeps AudioContext suspended until audioContext.resume() is called
		// from within a user-gesture event handler. The play button click is that gesture.
		if (audioCtx && audioCtx.state !== 'running') {
			audioCtx.resume();
			console.log('[FX] AudioContext resuming from playPause, was:', audioCtx.state);
		}
		ws?.playPause();
	}

	export function pause() {
		ws?.pause();
	}

	export function getIsPlaying(): boolean {
		return ws?.isPlaying() ?? false;
	}

	// Run applyEffects whenever the component is ready and effects change.
	// Only the $effect drives this — NOT the 'ready' callback — to avoid
	// a double-call race between the async applyEffects and the sync isReady setter.
	$effect(() => {
		if (!isReady || !ws) return;
		applyEffects(effects);
	});

	async function applyEffects(fx: EffectsConfig | null | undefined) {
		const generation = ++applyEffectsGeneration;
		console.log('[FX] effects config received', { generation, fx });

		const mediaEl = ws?.getMediaElement() as HTMLAudioElement | null;
		if (!mediaEl) {
			console.log('[FX] getMediaElement returned null — cannot apply effects');
			return;
		}

		// ── Tempo (no Web Audio needed — just playbackRate) ───────────────────
		if (fx?.tempo?.enabled && fx.tempo.rate !== 1) {
			mediaEl.playbackRate = fx.tempo.rate;
			console.log('[FX] applying tempo', fx.tempo.rate, '— playbackRate now', mediaEl.playbackRate);
		} else {
			mediaEl.playbackRate = 1;
		}

		if (fx?.flanger?.enabled) {
			console.log('[FX] flanger is enabled but not implemented (stub — audio passes through unmodified)');
		}

		// ── Decide if we need the Web Audio chain ─────────────────────────────
		const needsWebAudio =
			fx?.pitch?.enabled ||
			fx?.lowpass?.enabled ||
			fx?.highpass?.enabled ||
			fx?.bandpass?.enabled ||
			fx?.phaser?.enabled;

		if (!needsWebAudio) {
			// If a chain was previously built, route source directly to destination
			if (toneSourceNode && audioCtx) {
				toneSourceNode.disconnect();
				toneSourceNode.connect(audioCtx.destination);
				console.log('[FX] no Web Audio effects active — source routed to destination directly');
			}
			disposeToneNodes();
			return;
		}

		// ── Build Web Audio chain ─────────────────────────────────────────────
		const Tone = await import('tone');
		// Bail if a newer invocation has superseded this one while we awaited the import.
		if (generation !== applyEffectsGeneration) {
			console.log('[FX] stale after import — discarding gen', generation);
			return;
		}

		// Tone.start() will resolve immediately if the context is already running,
		// or queue a resume for the next user gesture. We also call audioCtx.resume()
		// in playPause() (synchronously on the click) to handle iOS/Safari strictly.
		await Tone.start();
		if (generation !== applyEffectsGeneration) {
			console.log('[FX] stale after Tone.start() — discarding gen', generation);
			return;
		}

		const ctx = Tone.context.rawContext as AudioContext;
		audioCtx = ctx;
		console.log('[FX] audio context state', ctx.state);

		const source = getOrCreateMediaElementSource(mediaEl, ctx);
		toneSourceNode = source;

		// Teardown previous chain before rebuilding
		const previousNodeCount = [toneLowpass, toneHighpass, toneBandpass, tonePhaser, tonePitchShift].filter(
			Boolean
		).length;
		console.log('[FX] tearing down chain', { nodeCount: previousNodeCount });
		source.disconnect();
		disposeToneNodes();
		console.log('[FX] teardown complete');

		// Tempo correction: changing playbackRate also shifts pitch by log2(rate)*12 st.
		// PitchShift at the end of the chain cancels this side-effect.
		const tempoRate = fx?.tempo?.enabled && fx.tempo.rate ? fx.tempo.rate : 1;
		const tempoCorrection = tempoRate !== 1 ? -Math.log2(tempoRate) * 12 : 0;
		const pitchSemitones = fx?.pitch?.enabled && fx.pitch ? fx.pitch.semitones : 0;

		// Build ordered chain of Tone nodes
		type TN = import('tone').ToneAudioNode;
		const chain: TN[] = [];

		if (fx?.lowpass?.enabled) {
			toneLowpass = new Tone.Filter(fx.lowpass.cutoff_hz, 'lowpass');
			chain.push(toneLowpass);
		}
		if (fx?.highpass?.enabled) {
			toneHighpass = new Tone.Filter(fx.highpass.cutoff_hz, 'highpass');
			chain.push(toneHighpass);
		}
		if (fx?.bandpass?.enabled) {
			toneBandpass = new Tone.Filter({ type: 'bandpass', frequency: fx.bandpass.freq_hz, Q: fx.bandpass.q });
			chain.push(toneBandpass);
		}
		if (fx?.phaser?.enabled) {
			tonePhaser = new Tone.Phaser({
				frequency: fx.phaser.rate_hz,
				octaves: fx.phaser.depth * 5,
				baseFrequency: 350
			});
			chain.push(tonePhaser);
		}

		// PitchShift always terminates the chain — handles pitch shift and tempo correction.
		// With pitch=0 and tempoCorrection=0 it is effectively a pass-through.
		tonePitchShift = new Tone.PitchShift(pitchSemitones + tempoCorrection);
		chain.push(tonePitchShift);

		// Connect source (native MediaElementAudioSourceNode) → chain[0] (Tone.js node).
		//
		// Root cause of "value not found" (getValueForKey): ToneAudioNode.input is itself
		// a ToneAudioNode (e.g. Tone.Gain), NOT a native AudioNode. Passing a ToneAudioNode
		// to the native AudioNode.connect() triggers Tone.js's internal graph registry lookup
		// which fails for nodes it didn't create the connection for.
		//
		// Fix: use Tone.connect(src, dst) which recursively unwraps dst.input until it
		// reaches a native AudioNode/AudioParam, then calls the native connect correctly.
		console.log('[FX] connecting', {
			from: 'MediaElementSource',
			to: chain[0].constructor.name,
			fromType: 'AudioNode',
			toType: 'ToneAudioNode'
		});
		Tone.connect(source as unknown as TN, chain[0]);
		for (let i = 0; i < chain.length - 1; i++) {
			console.log('[FX] connecting', {
				from: chain[i].constructor.name,
				to: chain[i + 1].constructor.name
			});
			chain[i].connect(chain[i + 1]);
		}
		chain[chain.length - 1].toDestination();

		console.log('[FX] chain built', {
			finalNodeCount: chain.length,
			chain: chain.map((n) => n.constructor.name),
			pitchSemitones,
			tempoRate,
			tempoCorrection: tempoCorrection.toFixed(2)
		});
	}

	onMount(() => {
		console.log('[FX] Waveform mounted', { src, effects });

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
				console.log('[FX] WaveSurfer ready', { mediaEl: ws?.getMediaElement(), effects });
				// applyEffects is driven by the $effect above — do not call it here
			});
			ws.on('play', () => onPlayStateChange?.(true));
			ws.on('pause', () => onPlayStateChange?.(false));
			ws.on('finish', () => onPlayStateChange?.(false));
			ws.on('timeupdate', (t: number) => onTimeUpdate?.(t, ws?.getDuration() ?? 0));
		});
	});

	onDestroy(() => {
		disposeToneNodes();
		if (toneSourceNode) {
			toneSourceNode.disconnect();
			toneSourceNode = null;
		}
		audioCtx = null;
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
