<script module lang="ts">
	// Module-level WeakMap: one MediaElementAudioSourceNode per HTMLAudioElement.
	// Creating a second source for the same element throws InvalidStateError.
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

	// Convert old clips.effects { pitch: number, tempo: number } → EffectsConfig
	function normalizeEffects(raw: unknown): EffectsConfig {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
		const r = raw as Record<string, unknown>;
		const hasObjectValue = Object.values(r).some((v) => v !== null && typeof v === 'object');
		if (hasObjectValue) return r as EffectsConfig;
		// Old format
		const config: EffectsConfig = {};
		if (typeof r.pitch === 'number' && r.pitch !== 0)
			config.pitch = { enabled: true, semitones: r.pitch, window_size: 0.1 };
		if (typeof r.tempo === 'number' && r.tempo !== 1)
			config.tempo = { enabled: true, rate: r.tempo };
		return config;
	}

	// Expand robot_voice preset into its constituent effects
	function expandRobotVoice(fx: EffectsConfig): EffectsConfig {
		if (!fx.robot_voice?.enabled) return fx;
		return {
			...fx,
			robot_voice: undefined,
			ring_mod: fx.ring_mod ?? { enabled: true, frequency: 30 },
			bitcrusher: fx.bitcrusher ?? { enabled: true, bits: 4 },
			highpass: fx.highpass ?? { enabled: true, frequency: 200, q: 1 }
		};
	}

	interface Props {
		src: string;
		height?: number;
		progressColor?: string;
		waveColor?: string;
		effects?: EffectsConfig | unknown;
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

	// Incremented each time applyEffects starts; async steps bail if generation changed.
	let applyGen = 0;

	// Disposable chain nodes (serial chain + extras like LFOs)
	let disposables: Array<{ dispose: () => void }> = [];
	let capturedSource: MediaElementAudioSourceNode | null = null;
	// First node in the serial chain — used by toggleReversePlay to wire the buffer source
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let firstSerialNode: any = null;

	// Reverse playback state
	let reverseBuffer: AudioBuffer | null = null;
	let reverseSource: AudioBufferSourceNode | null = null;
	let reverseIsPlaying = false;

	export function playPause() {
		if (reverseBuffer) {
			toggleReversePlay();
		} else {
			ws?.playPause();
		}
	}
	export function pause() {
		if (reverseIsPlaying) stopReversePlay();
		else ws?.pause();
	}
	export function getIsPlaying(): boolean {
		return reverseIsPlaying || (ws?.isPlaying() ?? false);
	}

	function stopReversePlay() {
		try {
			reverseSource?.stop();
		} catch {}
		reverseSource?.disconnect();
		reverseSource = null;
		reverseIsPlaying = false;
		onPlayStateChange?.(false);
	}

	async function toggleReversePlay() {
		if (reverseIsPlaying) {
			stopReversePlay();
			return;
		}
		if (!reverseBuffer) return;
		const Tone = await import('tone');
		await Tone.start();
		const ctx = Tone.context.rawContext as AudioContext;
		const bufSrc = ctx.createBufferSource();
		bufSrc.buffer = reverseBuffer;
		bufSrc.onended = () => {
			reverseIsPlaying = false;
			reverseSource = null;
			onPlayStateChange?.(false);
		};
		// Wire into the serial chain if one exists, else direct to destination
		if (firstSerialNode) {
			Tone.connect(bufSrc, firstSerialNode as import('tone').InputNode);
		} else {
			bufSrc.connect(ctx.destination);
		}
		bufSrc.start();
		reverseSource = bufSrc;
		reverseIsPlaying = true;
		onPlayStateChange?.(true);
	}

	$effect(() => {
		if (!isReady) return;
		applyEffects(normalizeEffects(effects));
	});

	async function applyEffects(fx: EffectsConfig) {
		const gen = ++applyGen;

		const wantsReverse = fx.reverse?.enabled === true;

		// Tear down previous chain
		disposeChain();

		const mediaEl = ws?.getMediaElement() as HTMLAudioElement | null;
		if (mediaEl) mediaEl.muted = wantsReverse;

		// Load reversed AudioBuffer when needed
		if (wantsReverse && !reverseBuffer) {
			let Tone = await import('tone');
			if (gen !== applyGen) return;
			const ctx = Tone.context.rawContext as AudioContext;
			try {
				const resp = await fetch(src, { credentials: 'omit' });
				if (gen !== applyGen) return;
				const arrayBuf = await resp.arrayBuffer();
				if (gen !== applyGen) return;
				const decoded = await ctx.decodeAudioData(arrayBuf);
				if (gen !== applyGen) return;
				for (let c = 0; c < decoded.numberOfChannels; c++) {
					decoded.getChannelData(c).reverse();
				}
				reverseBuffer = decoded;
			} catch {
				reverseBuffer = null;
			}
		} else if (!wantsReverse) {
			reverseBuffer = null;
			stopReversePlay();
		}

		if (gen !== applyGen) return;

		const cfg = expandRobotVoice(fx);

		// Determine tempo for playbackRate (applied regardless of Web Audio chain)
		const tempo = cfg.tempo?.enabled ? (cfg.tempo.rate ?? 1) : 1;
		if (mediaEl) mediaEl.playbackRate = tempo;

		// Check if we need Web Audio at all
		const needsChain =
			cfg.lowpass?.enabled ||
			cfg.highpass?.enabled ||
			cfg.bandpass?.enabled ||
			cfg.bitcrusher?.enabled ||
			cfg.ring_mod?.enabled ||
			cfg.phaser?.enabled ||
			cfg.flanger?.enabled ||
			cfg.delay?.enabled ||
			cfg.reverb?.enabled ||
			cfg.pitch?.enabled ||
			(cfg.tempo?.enabled && tempo !== 1); // tempo alone still needs PitchShift for correction

		const alreadyCaptured = mediaEl ? mediaElementSourceCache.has(mediaEl) : false;

		if (!needsChain && !alreadyCaptured && !wantsReverse) return;

		const Tone = await import('tone');
		if (gen !== applyGen) return;
		await Tone.start();
		if (gen !== applyGen) return;

		const ctx = Tone.context.rawContext as AudioContext;
		const newDisposables: Array<{ dispose: () => void }> = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const serialChain: any[] = [];

		// ── Filters ──────────────────────────────────────────────────────────
		if (cfg.lowpass?.enabled) {
			const f = new Tone.Filter({
				frequency: cfg.lowpass.frequency,
				type: 'lowpass' as const,
				Q: cfg.lowpass.q,
				rolloff: -12 as const
			});
			serialChain.push(f);
			newDisposables.push(f);
		}
		if (cfg.highpass?.enabled) {
			const f = new Tone.Filter({
				frequency: cfg.highpass.frequency,
				type: 'highpass' as const,
				Q: cfg.highpass.q,
				rolloff: -12 as const
			});
			serialChain.push(f);
			newDisposables.push(f);
		}
		if (cfg.bandpass?.enabled) {
			const bpCfg = cfg.bandpass;
			const qVal = Math.max(0.5, 48 / Math.max(1, bpCfg.width));
			const f = new Tone.Filter({
				frequency: bpCfg.frequency,
				type: 'bandpass' as const,
				Q: qVal
			});
			serialChain.push(f);
			newDisposables.push(f);
			if (bpCfg.mod_rate_hz > 0) {
				const lfo = new Tone.LFO({
					frequency: bpCfg.mod_rate_hz,
					min: bpCfg.frequency * 0.5,
					max: bpCfg.frequency * 2
				});
				lfo.connect(f.frequency);
				lfo.start();
				newDisposables.push(lfo);
			}
		}

		// ── BitCrusher ───────────────────────────────────────────────────────
		if (cfg.bitcrusher?.enabled) {
			const bc = new Tone.BitCrusher(cfg.bitcrusher.bits);
			serialChain.push(bc);
			newDisposables.push(bc);
		}

		// ── Ring modulator (FrequencyShifter approximation) ──────────────────
		if (cfg.ring_mod?.enabled) {
			const fs = new Tone.FrequencyShifter(cfg.ring_mod.frequency);
			serialChain.push(fs);
			newDisposables.push(fs);
		}

		// ── Phaser ───────────────────────────────────────────────────────────
		if (cfg.phaser?.enabled) {
			const phCfg = cfg.phaser;
			const ph = new Tone.Phaser({
				frequency: phCfg.frequency,
				octaves: phCfg.depth * 5,
				stages: phCfg.stages,
				baseFrequency: 350
			});
			serialChain.push(ph);
			newDisposables.push(ph);
		}

		// ── Flanger (Chorus approximation) ───────────────────────────────────
		if (cfg.flanger?.enabled) {
			const flCfg = cfg.flanger;
			const ch = new Tone.Chorus({
				frequency: flCfg.frequency,
				delayTime: flCfg.delay_time,
				depth: flCfg.depth * 100,
				feedback: flCfg.feedback,
				spread: 180
			});
			ch.start();
			serialChain.push(ch);
			newDisposables.push(ch);
		}

		// ── Delay ────────────────────────────────────────────────────────────
		if (cfg.delay?.enabled) {
			const dCfg = cfg.delay;
			const d = new Tone.FeedbackDelay(dCfg.time, dCfg.feedback);
			d.wet.value = dCfg.wet;
			serialChain.push(d);
			newDisposables.push(d);
		}

		// ── Reverb (async generate) ──────────────────────────────────────────
		if (cfg.reverb?.enabled) {
			const rvCfg = cfg.reverb;
			const r = new Tone.Reverb({ decay: rvCfg.decay, preDelay: rvCfg.pre_delay });
			r.wet.value = rvCfg.wet;
			await r.generate();
			if (gen !== applyGen) {
				r.dispose();
				newDisposables.forEach((n) => n.dispose());
				return;
			}
			serialChain.push(r);
			newDisposables.push(r);
		}

		// ── Pitch + tempo correction ─────────────────────────────────────────
		const semitones = cfg.pitch?.enabled ? (cfg.pitch.semitones ?? 0) : 0;
		const windowSize = cfg.pitch?.enabled ? (cfg.pitch.window_size ?? 0.1) : 0.1;
		const tempoCorrection = -Math.log2(tempo) * 12;
		const totalPitch = semitones + (tempo !== 1 ? tempoCorrection : 0);

		if (cfg.pitch?.enabled || (tempo !== 1 && needsChain)) {
			const ps = new Tone.PitchShift({ pitch: totalPitch, windowSize });
			serialChain.push(ps);
			newDisposables.push(ps);
		}

		if (gen !== applyGen) {
			newDisposables.forEach((n) => n.dispose());
			return;
		}

		disposables = newDisposables;
		firstSerialNode = serialChain.length > 0 ? serialChain[0] : null;

		// Wire serial chain
		for (let i = 0; i < serialChain.length - 1; i++) {
			serialChain[i].connect(serialChain[i + 1]);
		}
		if (serialChain.length > 0) {
			serialChain[serialChain.length - 1].toDestination();
		}

		// Wire media element source into chain (if not reverse-only mode)
		if (!wantsReverse && mediaEl) {
			const source = getOrCreateMediaElementSource(mediaEl, ctx);
			source.disconnect();
			if (serialChain.length > 0) {
				Tone.connect(source, serialChain[0] as import('tone').InputNode);
			} else {
				source.connect(ctx.destination);
			}
			capturedSource = source;
		}
	}

	function disposeChain() {
		stopReversePlay();

		capturedSource?.disconnect();
		capturedSource = null;
		firstSerialNode = null;

		for (const node of disposables) {
			try {
				node.dispose();
			} catch {}
		}
		disposables = [];

		const mediaEl = ws?.getMediaElement() as HTMLAudioElement | null;
		if (mediaEl) {
			mediaEl.playbackRate = 1;
			mediaEl.muted = false;
		}
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
			ws.on('ready', () => {
				isReady = true;
			});
			ws.on('play', () => onPlayStateChange?.(true));
			ws.on('pause', () => onPlayStateChange?.(false));
			ws.on('finish', () => onPlayStateChange?.(false));
			ws.on('timeupdate', (t: number) => onTimeUpdate?.(t, ws?.getDuration() ?? 0));
		});
	});

	onDestroy(() => {
		disposeChain();
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
