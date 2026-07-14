<script module lang="ts">
	// Module-level cache: one MediaElementAudioSourceNode per HTMLAudioElement.
	// The Web Audio API forbids creating a second source for the same element —
	// this prevents the InvalidStateError that occurs when applyEffects runs
	// concurrently (e.g. from both the WaveSurfer 'ready' callback and the
	// reactive $effect that fires when isReady becomes true).
	const mediaElementSourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

	/** Tone.PitchShift grain window (seconds) for a plain pitch effect with no
	 *  per-challenge window_size set. Tone's own nominal range is 0.03–0.1. */
	const DEFAULT_PITCH_WINDOW = 0.1;

	/** Grain window used when the PitchShift carries the varispeed tempo correction.
	 *  RETUNE HERE — this is the single knob for the tempo artefact. Raised from 0.1
	 *  to 0.2 because the correction lands on bass-heavy material where a 0.1 s grain
	 *  is only ~6 cycles of a 60 Hz kick and measured dirtiest of everything tried.
	 *  Above Tone's nominal 0.1 ceiling deliberately; the cost is transient smearing,
	 *  so if kicks start to flam, come back down (0.15 was equally clean at 60 Hz). */
	const VARISPEED_PITCH_WINDOW = 0.2;

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
	import { clampTempoRate } from '$lib/audio-limits.js';

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

	// Lazy Tone.js module — warmed in onMount so the play-gesture path awaits
	// milliseconds, not a cold chunk fetch.
	let tonePromise: Promise<typeof import('tone')> | null = null;
	function loadTone() {
		tonePromise ??= import('tone');
		return tonePromise;
	}

	// Signature of the effects config the chain last SUCCESSFULLY finished
	// applying. null until then — ensureChain() keeps retrying while it's stale,
	// which is what makes the pre-gesture deadlock recoverable from the play
	// click (the old one-shot $effect build got exactly one pre-gesture attempt
	// and could never be retried).
	let appliedSig: string | null = null;
	let applyInFlight: Promise<void> | null = null;

	/** DEV-only A/B switch for the tempo strategy. `window.__varispeedOff = true`
	 *  forces preservesPitch=true and (via the readback guard) a zero correction, i.e.
	 *  the browser's WSOLA stretcher with exact pitch — what reverting fix 4 would
	 *  ship. Default/false keeps fix 4: varispeed + granular pitch correction.
	 *  Lets the same clip be judged both ways without recompiling. Elided in prod. */
	function varispeedDisabled(): boolean {
		return (
			import.meta.env.DEV &&
			typeof window !== 'undefined' &&
			(window as unknown as Record<string, unknown>).__varispeedOff === true
		);
	}

	/** The chain's identity. The A/B flag is part of it so that flipping
	 *  __varispeedOff invalidates appliedSig and the next play rebuilds — otherwise
	 *  ensureChain would no-op and the toggle would appear to do nothing. */
	function configSig(fx: EffectsConfig | null | undefined): string {
		return JSON.stringify(fx ?? {}) + (varispeedDisabled() ? '|novarispeed' : '');
	}

	/** Idempotent, retryable chain establishment. Fast no-op when the chain is
	 *  already connected for the current config. Bounded loop: a config change
	 *  can land while a build is in flight, and a not-yet-ready component makes
	 *  no progress — never spin forever. */
	async function ensureChain(): Promise<void> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const sig = configSig(effects);
			if (appliedSig === sig) return;
			if (!applyInFlight) {
				applyInFlight = applyEffects(effects).finally(() => (applyInFlight = null));
			}
			try {
				await applyInFlight;
			} catch {
				/* applyEffects already fell back to direct routing where possible */
			}
		}
	}

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
		} catch {
			/* noop — stop may throw if LFO was never started */
		}
		toneBandpassLfo?.dispose();
		toneBandpassLfo = null;
		toneBitcrusher?.dispose();
		toneBitcrusher = null;
		toneRingMod?.dispose();
		toneRingMod = null;
		try {
			toneFlangerLfo?.stop();
		} catch {
			/* noop */
		}
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
			} catch {
				/* noop — stop throws if buffer source has already ended */
			}
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

	export async function playPause() {
		// Resume the AudioContext synchronously INSIDE the user gesture. This is
		// the deadlock-breaker: a chain build started pre-gesture parks on
		// Tone.start(), and since audioCtx is now assigned BEFORE that await (see
		// applyEffects + the onMount preload), this resume un-pends it. Callers
		// invoke playPause() directly from a click handler, so this line runs
		// within the gesture even though the function is async.
		if (audioCtx && audioCtx.state !== 'running') {
			audioCtx.resume();
		}
		// Establish the chain (or the reverse buffer) before playback starts —
		// idempotent and milliseconds when already built. The timeout race means a
		// pathologically stuck build degrades to dry playback instead of a dead
		// play button.
		await Promise.race([ensureChain(), new Promise((r) => setTimeout(r, 1500))]);

		// Route to reverse path if enabled — bypasses WaveSurfer entirely
		if (effects?.reverse?.enabled) {
			if (reverseIsPlaying) {
				stopReversePlayback();
			} else {
				startReversePlayback();
			}
			return;
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

	// Reconfiguration driver — routes through the SAME retryable ensureChain path
	// as playPause() (no separate one-shot build). The first application runs
	// immediately on ready; later re-runs are debounced ~200ms because the editor
	// reassigns `effects` per slider INPUT EVENT, and rebuilding the full chain on
	// each one machine-gunned teardown/reconnect glitches into live playback (the
	// editor stutter). Separate concern from EffectsEditor's 600ms SAVE debounce.
	let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
	let firstApply = true;
	$effect(() => {
		if (!isReady || !ws) return;
		void effects; // track the prop — the editor swaps in a new object per edit
		clearTimeout(rebuildTimer);
		if (firstApply) {
			firstApply = false;
			ensureChain();
		} else {
			rebuildTimer = setTimeout(() => ensureChain(), 200);
		}
	});

	async function applyEffects(fx: EffectsConfig | null | undefined) {
		const generation = ++applyEffectsGeneration;
		// Marked applied ONLY at a success point — stale-generation bails and
		// not-ready returns leave it unset so ensureChain() retries.
		const sig = configSig(fx);

		const mediaEl = ws?.getMediaElement() as HTMLAudioElement | null;
		if (!mediaEl) return;

		// ── Reverse mode — bypasses the Tone chain entirely ───────────────────────
		if (fx?.reverse?.enabled) {
			mediaEl.volume = 0;
			stopReversePlayback();

			const Tone = await loadTone();
			if (generation !== applyEffectsGeneration) return;
			// Expose the context BEFORE awaiting Tone.start() so playPause()'s
			// in-gesture resume guard can un-pend it (the round-2 deadlock).
			const ctx = Tone.context.rawContext as AudioContext;
			audioCtx = ctx;
			await Tone.start();
			if (generation !== applyEffectsGeneration) return;

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
			appliedSig = sig;
			return;
		}

		// ── Normal mode ───────────────────────────────────────────────────────────
		mediaEl.volume = 1;
		stopReversePlayback();

		// ── Tempo (fix 4: varispeed + PitchShift correction) ──────────────────────
		// The browser's preservesPitch time-stretcher (WSOLA) glitches on music, so
		// when rate ≠ 1 we take it out of the pipeline: preservesPitch = false makes
		// playbackRate plain varispeed (speed and pitch move together, glitch-free)
		// and the chain adds a PitchShift that puts the pitch back.
		//
		// DERIVATION of the correction sign — varispeed at rate r multiplies every
		// frequency by r, i.e. transposes by +12·log2(r) semitones (r>1 up, r<1 down).
		// For a desired net transposition P (the pitch effect; P = 0 for tempo alone):
		//     12·log2(r) + C = P   ⇒   C = P − 12·log2(r)
		//   r = 1.25 → C = P − 3.86 st (correct DOWN);  r = 0.8 → C = P + 3.86 st (UP).
		// Measured, not assumed: a 440 Hz tone through a captured media element at
		// r = 1.25 with preservesPitch=false comes out at 550 Hz (= +3.86 st) in
		// Chromium, Firefox and WebKit alike — so C must be negative there.
		// Clamped at apply time, not in storage: a challenge saved before the range was
		// narrowed (or a preset, or a hand-edited JSONB row) would otherwise demand a
		// correction far outside what the granular shifter can deliver — a legacy 2.0×
		// would ask for −12 st. Clamping here means playbackRate AND the correction
		// below both derive from the same bounded rate, so they cannot disagree.
		// The `&& fx.tempo.rate` guard is deliberate: a stored 0 (or absent) rate means
		// "no tempo", and must stay 1 rather than clamp up to the 0.85 floor.
		const tempoRate = fx?.tempo?.enabled && fx.tempo.rate ? clampTempoRate(fx.tempo.rate) : 1;
		const mediaElAny = mediaEl as HTMLAudioElement & {
			mozPreservesPitch?: boolean;
			webkitPreservesPitch?: boolean;
		};
		// __varispeedOff (DEV) hands tempo back to the browser stretcher: preservesPitch
		// stays true, and the readback guard below then derives a zero correction on its
		// own — the A/B needs no second code path, which is the point of the guard.
		const noVarispeed = varispeedDisabled();
		const preserve = tempoRate === 1 || noVarispeed;
		mediaElAny.preservesPitch = preserve;
		mediaElAny.mozPreservesPitch = preserve;
		mediaElAny.webkitPreservesPitch = preserve;
		mediaEl.playbackRate = tempoRate;

		// Read back rather than assume. The correction above is only valid if the
		// engine ACTUALLY dropped pitch preservation; if it silently kept the
		// stretcher on, applying C anyway detunes by the full −12·log2(r) (≈4 st at
		// 1.25×) — audible as "too low when faster / too high when slower". Deriving
		// this once here and threading it into buildChain also removes the previous
		// split-brain hazard, where applyEffects decided whether to engage varispeed
		// and buildChain independently re-decided whether to correct for it: nothing
		// forced those two derivations to agree.
		const varispeedActive =
			!noVarispeed && tempoRate !== 1 && mediaElAny.preservesPitch === false;
		const varispeedCorrection = varispeedActive ? -12 * Math.log2(tempoRate) : 0;

		// ── Decide if we need the Web Audio chain ─────────────────────────────────
		// tempoRate ≠ 1 requires the graph for its varispeed pitch correction —
		// tempo-alone now routes through the chain too (it stuttered natively).
		const needsWebAudio =
			tempoRate !== 1 ||
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
			appliedSig = sig;
			return;
		}

		// ── Build Web Audio chain ─────────────────────────────────────────────────
		const Tone = await loadTone();
		// Bail if a newer invocation has superseded this one while we awaited the import.
		if (generation !== applyEffectsGeneration) return;

		// Expose the context BEFORE awaiting Tone.start(): playPause()'s in-gesture
		// resume guard needs it to un-pend a pre-gesture start. Assigning it only
		// after the await was the round-2 circular deadlock — the guard that exists
		// to resume the context could never see the context until it had resumed.
		const ctx = Tone.context.rawContext as AudioContext;
		audioCtx = ctx;

		// Tone.start() resolves immediately if the context is already running, or
		// stays pending until a resume lands inside a user gesture — playPause()
		// provides that synchronously on the click.
		await Tone.start();
		if (generation !== applyEffectsGeneration) return;

		try {
			await buildChain(Tone, ctx, mediaEl, fx, generation, varispeedCorrection);
			if (generation !== applyEffectsGeneration) return;
			appliedSig = sig;
		} catch (err) {
			// Never leave the element captured-but-unrouted (silent): fall back to a
			// direct source→destination connection — dry playback, but audible.
			console.error('[Waveform] effect chain build failed — playing dry', err);
			// The varispeed pitch correction lived in the failed chain — hand tempo
			// back to the browser stretcher so pitch stays right (its stutter is
			// acceptable in this failure-only path).
			mediaElAny.preservesPitch = true;
			mediaElAny.mozPreservesPitch = true;
			mediaElAny.webkitPreservesPitch = true;
			disposeToneNodes();
			try {
				if (toneSourceNode) {
					toneSourceNode.disconnect();
					toneSourceNode.connect(ctx.destination);
				}
			} catch {
				/* element never captured — native playback is already audible */
			}
			// Mark applied so ensureChain doesn't retry a deterministically failing
			// config forever; any config change resets the signature.
			appliedSig = sig;
		}
	}

	async function buildChain(
		Tone: Awaited<ReturnType<typeof loadTone>>,
		ctx: AudioContext,
		mediaEl: HTMLAudioElement,
		fx: EffectsConfig | null | undefined,
		generation: number,
		/** Semitones of varispeed compensation; 0 unless varispeed actually engaged. */
		varispeedCorrection: number
	) {
		const source = getOrCreateMediaElementSource(mediaEl, ctx);
		toneSourceNode = source;

		// Teardown previous chain before rebuilding
		source.disconnect();
		disposeToneNodes();

		// Build ordered chain of Tone nodes
		// Order: lowpass → highpass → bandpass → bitcrusher → ring_mod
		//        → phaser → flanger → delay → reverb → pitchShift
		type TN = import('tone').ToneAudioNode;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const chain: any[] = [];

		if (fx?.lowpass?.enabled) {
			toneLowpass = new Tone.Filter({
				type: 'lowpass',
				frequency: fx.lowpass.cutoff_hz,
				Q: fx.lowpass.q
			});
			chain.push(toneLowpass);
		}
		if (fx?.highpass?.enabled) {
			toneHighpass = new Tone.Filter({
				type: 'highpass',
				frequency: fx.highpass.cutoff_hz,
				Q: fx.highpass.q
			});
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

		// One PitchShift serves both jobs — never two stacked instances (each adds
		// ~100ms granular latency): the pitch EFFECT's semitones plus the varispeed
		// correction C computed by applyEffects (see the derivation there). C arrives
		// as a parameter and is already 0 unless varispeed actually engaged, so the
		// correction can never be applied to audio the browser is still pitch-
		// preserving. At net 0 the node is omitted entirely — even a 0-semitone
		// PitchShift runs its full granular topology (two LFO-modulated delay lines +
		// a crossfade LFO, all started at construction) and was a stutter source as
		// an always-on "pass-through".
		const effectSemitones = fx?.pitch?.enabled ? fx.pitch.semitones : 0;
		const netSemitones = effectSemitones + varispeedCorrection;
		if (netSemitones !== 0) {
			// Grain window. Only overridden when this node is carrying the varispeed
			// correction; a pure pitch effect keeps the host's per-challenge
			// window_size, so retuning tempo can't silently change what the editor
			// configured. Measured (Tone.PitchShift, −3.86 st, purity = peak-lobe
			// energy / total): at a 60 Hz kick fundamental, windowSize 0.1 is the
			// WORST of everything tested (72%), while 0.15–0.2 sit at ~99% — a grain
			// window has to span several periods, and 0.1 s is only ~6 cycles at 60 Hz.
			// The counter-pressure is time smearing: a longer window flams transients,
			// and hard-bass is all transient. Hence a named constant — this is an
			// ear call, not a solved number.
			const windowSize =
				varispeedCorrection !== 0
					? VARISPEED_PITCH_WINDOW
					: (fx?.pitch?.enabled ? fx.pitch.window_size : DEFAULT_PITCH_WINDOW);
			tonePitchShift = new Tone.PitchShift({
				pitch: netSemitones,
				windowSize
			});
			chain.push(tonePitchShift);
		}

		if (chain.length === 0) {
			// Nothing to insert (e.g. pitch enabled at 0 semitones) — route the
			// captured source straight through so playback stays audible.
			source.connect(ctx.destination);
			return;
		}

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
		// Warm the tone chunk and grab the shared AudioContext immediately, so the
		// play gesture's resume guard has a context to act on even before the first
		// chain build reaches its own assignment (a cold chunk fetch used to leave
		// audioCtx null through the whole first-play window).
		loadTone().then((Tone) => {
			audioCtx = Tone.context.rawContext as AudioContext;
		});
		import('wavesurfer.js').then(({ default: WaveSurfer }) => {
			const mediaEl = document.createElement('audio');
			mediaEl.crossOrigin = 'anonymous';
			// Dev-only handle on the element the graph actually captures. This element
			// is deliberately never appended to the DOM (WaveSurfer only needs the
			// object), so document.querySelectorAll('audio') CANNOT find it — it finds
			// the unrelated <audio controls> preview players instead, which nothing ever
			// sets tempo on and which therefore report their untouched defaults
			// (playbackRate=1, preservesPitch=true). Reading those and concluding "the
			// app reset preservesPitch" cost us a full debugging round. Inspect
			// window.__waveformEl instead.
			if (import.meta.env.DEV) {
				(window as unknown as Record<string, unknown>).__waveformEl = mediaEl;
			}
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
		clearTimeout(rebuildTimer);
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
