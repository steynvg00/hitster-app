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

	// Tone.js chain nodes
	let toneSourceNode: MediaElementAudioSourceNode | null = null;
	let toneLowpass: import('tone').Filter | null = null;
	let toneHighpass: import('tone').Filter | null = null;
	let toneBandpass: import('tone').Filter | null = null;
	let toneBandpassLfo: import('tone').LFO | null = null;
	let toneBitcrusher: import('tone').BitCrusher | null = null;
	let toneRingMod: import('tone').FrequencyShifter | null = null;
	let tonePhaser: import('tone').Phaser | null = null;
	let toneFlanger: import('tone').FeedbackDelay | null = null;
	let toneFlangerLfo: import('tone').LFO | null = null;
	let toneDelay: import('tone').FeedbackDelay | null = null;
	let toneReverb: import('tone').Reverb | null = null;
	let tonePitchShift: import('tone').PitchShift | null = null;

	// Reverse playback path — bypasses Tone chain entirely
	let reverseBuffer: AudioBuffer | null = null;
	let reverseBufSrc: AudioBufferSourceNode | null = null;
	let reverseIsPlaying = false;
	let reverseSrcCache = ''; // tracks which src the buffer was loaded from

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
		try {
			toneBandpassLfo?.stop();
		} catch {}
		toneBandpassLfo?.dispose();
		toneBandpassLfo = null;
		toneBitcrusher?.dispose();
		toneBitcrusher = null;
		toneRingMod?.dispose();
		toneRingMod = null;
		try {
			toneFlangerLfo?.stop();
		} catch {}
		toneFlangerLfo?.dispose();
		toneFlangerLfo = null;
		toneFlanger?.dispose();
		toneFlanger = null;
		toneDelay?.dispose();
		toneDelay = null;
		toneReverb?.dispose();
		toneReverb = null;
	}

	function stopReversePlayback() {
		if (reverseBufSrc) {
			try {
				reverseBufSrc.stop();
			} catch {}
			reverseBufSrc.disconnect();
			reverseBufSrc = null;
		}
		if (reverseIsPlaying) {
			reverseIsPlaying = false;
			onPlayStateChange?.(false);
		}
	}

	function startReversePlayback() {
		if (!reverseBuffer || !audioCtx) return;
		reverseBufSrc = audioCtx.createBufferSource();
		reverseBufSrc.buffer = reverseBuffer;
		reverseBufSrc.connect(audioCtx.destination);
		reverseBufSrc.onended = () => {
			reverseIsPlaying = false;
			reverseBufSrc = null;
			onPlayStateChange?.(false);
		};
		reverseBufSrc.start();
		reverseIsPlaying = true;
		onPlayStateChange?.(true);
	}

	export function playPause() {
		// Route to reverse path if enabled — bypasses WaveSurfer entirely
		if (effects?.reverse?.enabled) {
			if (reverseIsPlaying) {
				stopReversePlayback();
			} else {
				startReversePlayback();
			}
			return;
		}
		// Resume AudioContext synchronously from user gesture.
		// iOS/Safari keeps AudioContext suspended until audioContext.resume() is called
		// from within a user-gesture event handler. The play button click is that gesture.
		if (audioCtx && audioCtx.state !== 'running') {
			audioCtx.resume();
		}
		ws?.playPause();
	}

	export function pause() {
		if (effects?.reverse?.enabled) {
			stopReversePlayback();
			return;
		}
		ws?.pause();
	}

	export function getIsPlaying(): boolean {
		if (effects?.reverse?.enabled) return reverseIsPlaying;
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

		const mediaEl = ws?.getMediaElement() as HTMLAudioElement | null;
		if (!mediaEl) return;

		// ── Reverse mode — bypasses the Tone chain entirely ───────────────────────
		if (fx?.reverse?.enabled) {
			mediaEl.volume = 0;
			stopReversePlayback();

			const Tone = await import('tone');
			if (generation !== applyEffectsGeneration) return;
			await Tone.start();
			if (generation !== applyEffectsGeneration) return;
			const ctx = Tone.context.rawContext as AudioContext;
			audioCtx = ctx;

			// Bypass Tone chain on the media element source
			if (toneSourceNode) {
				toneSourceNode.disconnect();
				toneSourceNode.connect(ctx.destination);
			}
			disposeToneNodes();

			// Only re-fetch if the src changed
			if (reverseSrcCache !== src || !reverseBuffer) {
				const resp = await fetch(src);
				if (generation !== applyEffectsGeneration) return;
				const arr = await resp.arrayBuffer();
				if (generation !== applyEffectsGeneration) return;
				const decoded = await ctx.decodeAudioData(arr);
				if (generation !== applyEffectsGeneration) return;
				// Reverse all channels in-place
				for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
					decoded.getChannelData(ch).reverse();
				}
				reverseBuffer = decoded;
				reverseSrcCache = src;
			}
			return;
		}

		// ── Normal mode ───────────────────────────────────────────────────────────
		mediaEl.volume = 1;
		stopReversePlayback();

		// ── Tempo (playbackRate only — no Web Audio node needed) ──────────────────
		mediaEl.playbackRate = fx?.tempo?.enabled && fx.tempo.rate ? fx.tempo.rate : 1;

		// ── Decide if we need the Web Audio chain ─────────────────────────────────
		const needsWebAudio =
			fx?.pitch?.enabled ||
			fx?.lowpass?.enabled ||
			fx?.highpass?.enabled ||
			fx?.bandpass?.enabled ||
			fx?.phaser?.enabled ||
			fx?.flanger?.enabled ||
			fx?.bitcrusher?.enabled ||
			fx?.ring_mod?.enabled ||
			fx?.delay?.enabled ||
			fx?.reverb?.enabled;

		if (!needsWebAudio) {
			// If a chain was previously built, route source directly to destination
			if (toneSourceNode && audioCtx) {
				toneSourceNode.disconnect();
				toneSourceNode.connect(audioCtx.destination);
			}
			disposeToneNodes();
			return;
		}

		// ── Build Web Audio chain ─────────────────────────────────────────────────
		const Tone = await import('tone');
		// Bail if a newer invocation has superseded this one while we awaited the import.
		if (generation !== applyEffectsGeneration) return;

		// Tone.start() will resolve immediately if the context is already running,
		// or queue a resume for the next user gesture. We also call audioCtx.resume()
		// in playPause() (synchronously on the click) to handle iOS/Safari strictly.
		await Tone.start();
		if (generation !== applyEffectsGeneration) return;

		const ctx = Tone.context.rawContext as AudioContext;
		audioCtx = ctx;

		const source = getOrCreateMediaElementSource(mediaEl, ctx);
		toneSourceNode = source;

		// Teardown previous chain before rebuilding
		source.disconnect();
		disposeToneNodes();

		// Tempo correction: changing playbackRate also shifts pitch by log2(rate)*12 st.
		// PitchShift at the end of the chain cancels this side-effect.
		const tempoRate = fx?.tempo?.enabled && fx.tempo.rate ? fx.tempo.rate : 1;
		const tempoCorrection = tempoRate !== 1 ? -Math.log2(tempoRate) * 12 : 0;
		const pitchSemitones = fx?.pitch?.enabled ? fx.pitch.semitones : 0;
		const windowSize = fx?.pitch?.enabled ? fx.pitch.window_size : 0.1;

		// Build ordered chain of Tone nodes
		// Order: lowpass → highpass → bandpass → bitcrusher → ring_mod
		//        → phaser → flanger → delay → reverb → pitchShift
		type TN = import('tone').ToneAudioNode;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const chain: any[] = [];

		if (fx?.lowpass?.enabled) {
			toneLowpass = new Tone.Filter({ type: 'lowpass', frequency: fx.lowpass.cutoff_hz, Q: fx.lowpass.q });
			chain.push(toneLowpass);
		}
		if (fx?.highpass?.enabled) {
			toneHighpass = new Tone.Filter({ type: 'highpass', frequency: fx.highpass.cutoff_hz, Q: fx.highpass.q });
			chain.push(toneHighpass);
		}
		if (fx?.bandpass?.enabled) {
			toneBandpass = new Tone.Filter({ type: 'bandpass', Q: fx.bandpass.q });
			if (fx.bandpass.mod_rate_hz > 0) {
				// LFO controls frequency; set base to 0 so LFO value is the actual frequency
				toneBandpass.frequency.value = 0;
				toneBandpassLfo = new Tone.LFO({
					frequency: fx.bandpass.mod_rate_hz,
					min: fx.bandpass.freq_hz * 0.5,
					max: fx.bandpass.freq_hz * 2
				});
				toneBandpassLfo.connect(toneBandpass.frequency);
				toneBandpassLfo.start();
			} else {
				toneBandpass.frequency.value = fx.bandpass.freq_hz;
			}
			chain.push(toneBandpass);
		}
		if (fx?.bitcrusher?.enabled) {
			toneBitcrusher = new Tone.BitCrusher({ bits: Math.max(1, Math.min(16, fx.bitcrusher.bits)) });
			chain.push(toneBitcrusher);
		}
		if (fx?.ring_mod?.enabled) {
			toneRingMod = new Tone.FrequencyShifter(fx.ring_mod.freq_hz);
			toneRingMod.wet.value = fx.ring_mod.depth;
			chain.push(toneRingMod);
		}
		if (fx?.phaser?.enabled) {
			tonePhaser = new Tone.Phaser({
				frequency: fx.phaser.rate_hz,
				octaves: fx.phaser.depth * 5,
				stages: Math.max(2, Math.min(12, fx.phaser.stages)),
				Q: fx.phaser.feedback * 10,
				baseFrequency: 350
			});
			chain.push(tonePhaser);
		}
		if (fx?.flanger?.enabled) {
			// Flanger: FeedbackDelay with short base (0ms so LFO controls entirely) + LFO
			toneFlanger = new Tone.FeedbackDelay(0, fx.flanger.feedback);
			toneFlanger.wet.value = fx.flanger.depth;
			toneFlangerLfo = new Tone.LFO({ frequency: fx.flanger.rate_hz, min: 0.001, max: 0.01 });
			toneFlangerLfo.connect(toneFlanger.delayTime);
			toneFlangerLfo.start();
			chain.push(toneFlanger);
		}
		if (fx?.delay?.enabled) {
			toneDelay = new Tone.FeedbackDelay(fx.delay.time_ms / 1000, fx.delay.feedback);
			toneDelay.wet.value = fx.delay.wet;
			chain.push(toneDelay);
		}
		if (fx?.reverb?.enabled) {
			toneReverb = new Tone.Reverb({
				decay: fx.reverb.decay_s,
				preDelay: fx.reverb.pre_delay_ms / 1000
			});
			toneReverb.wet.value = fx.reverb.wet;
			// generate() is async — must check generation counter after await
			await toneReverb.generate();
			if (generation !== applyEffectsGeneration) {
				toneReverb.dispose();
				toneReverb = null;
				return;
			}
			chain.push(toneReverb);
		}

		// PitchShift always terminates the chain — handles pitch shift and tempo correction.
		// With pitch=0 and tempoCorrection=0 it is effectively a pass-through.
		tonePitchShift = new Tone.PitchShift({ pitch: pitchSemitones + tempoCorrection, windowSize });
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
		Tone.connect(source as unknown as TN, chain[0]);
		for (let i = 0; i < chain.length - 1; i++) {
			chain[i].connect(chain[i + 1]);
		}
		chain[chain.length - 1].toDestination();
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
		stopReversePlayback();
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
