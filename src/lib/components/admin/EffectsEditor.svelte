<script lang="ts">
	import { BUILTIN_PRESETS } from '$lib/effects-presets.js';
	import Waveform from '$lib/components/ui/Waveform.svelte';
	import type {
		EffectsConfig,
		EffectPreset,
		LowpassConfig,
		HighpassConfig,
		BandpassConfig,
		PhaserConfig,
		FlangerConfig,
		BitCrusherConfig,
		RingModConfig,
		DelayConfig,
		ReverbConfig,
		PitchConfig,
		TempoConfig
	} from '$lib/types/index.js';

	interface Props {
		initial: EffectsConfig;
		userPresets?: EffectPreset[];
		previewSrc?: string | null;
	}

	let { initial, userPresets = [], previewSrc = null }: Props = $props();

	let effects = $state<EffectsConfig>({ ...initial });
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let debounceTimer: ReturnType<typeof setTimeout>;
	let newPresetName = $state('');
	let savingPreset = $state(false);

	const EFFECT_KEYS = [
		'pitch',
		'tempo',
		'lowpass',
		'highpass',
		'bandpass',
		'phaser',
		'flanger',
		'bitcrusher',
		'ring_mod',
		'delay',
		'reverb',
		'reverse',
		'robot_voice'
	] as const;

	type EffectKey = (typeof EFFECT_KEYS)[number];

	const LABELS: Record<EffectKey, string> = {
		pitch: 'Pitch',
		tempo: 'Tempo',
		lowpass: 'Lowpass',
		highpass: 'Highpass',
		bandpass: 'Bandpass',
		phaser: 'Phaser',
		flanger: 'Flanger',
		bitcrusher: 'BitCrush',
		ring_mod: 'Ring Mod',
		delay: 'Delay',
		reverb: 'Reverb',
		reverse: 'Reverse',
		robot_voice: 'Robot'
	};

	const DEFAULTS: Record<EffectKey, unknown> = {
		pitch: { enabled: true, semitones: 0, window_size: 0.1 } satisfies PitchConfig,
		tempo: { enabled: true, rate: 0.75 } satisfies TempoConfig,
		lowpass: { enabled: true, frequency: 1000, q: 1 } satisfies LowpassConfig,
		highpass: { enabled: true, frequency: 300, q: 1 } satisfies HighpassConfig,
		bandpass: { enabled: true, frequency: 800, width: 12, mod_rate_hz: 0 } satisfies BandpassConfig,
		phaser: {
			enabled: true,
			frequency: 1,
			depth: 0.5,
			stages: 4,
			feedback: 0.5,
			stereo_offset: 0.02
		} satisfies PhaserConfig,
		flanger: {
			enabled: true,
			frequency: 1,
			depth: 0.5,
			feedback: 0.3,
			delay_time: 5
		} satisfies FlangerConfig,
		bitcrusher: { enabled: true, bits: 8 } satisfies BitCrusherConfig,
		ring_mod: { enabled: true, frequency: 100 } satisfies RingModConfig,
		delay: { enabled: true, time: 0.3, feedback: 0.4, wet: 0.5 } satisfies DelayConfig,
		reverb: { enabled: true, decay: 2.5, pre_delay: 0.01, wet: 0.5 } satisfies ReverbConfig,
		reverse: { enabled: true },
		robot_voice: { enabled: true }
	};

	function isOn(key: EffectKey): boolean {
		return (effects[key] as { enabled?: boolean } | undefined)?.enabled === true;
	}

	function toggle(key: EffectKey) {
		const cur = effects[key] as { enabled?: boolean } | undefined;
		effects = {
			...effects,
			[key]: cur ? { ...cur, enabled: !cur.enabled } : DEFAULTS[key]
		};
		scheduleSave();
	}

	function patch(key: EffectKey, fields: Record<string, unknown>) {
		effects = { ...effects, [key]: { ...(effects[key] as object), ...fields } };
		scheduleSave();
	}

	function scheduleSave() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(doSave, 600);
	}

	async function doSave() {
		saveStatus = 'saving';
		try {
			const fd = new FormData();
			fd.set('effects', JSON.stringify(effects));
			const res = await fetch('?/saveEffects', { method: 'POST', body: fd });
			saveStatus = res.ok ? 'saved' : 'error';
		} catch {
			saveStatus = 'error';
		}
		setTimeout(() => (saveStatus = 'idle'), 2000);
	}

	function loadPreset(p: EffectPreset) {
		effects = { ...p.effects };
		scheduleSave();
	}

	async function saveAsPreset() {
		const name = newPresetName.trim();
		if (!name || savingPreset) return;
		savingPreset = true;
		const fd = new FormData();
		fd.set('name', name);
		fd.set('effects', JSON.stringify(effects));
		await fetch('?/savePreset', { method: 'POST', body: fd });
		newPresetName = '';
		savingPreset = false;
		location.reload();
	}

	async function deletePreset(id: string) {
		if (!confirm('Delete this preset?')) return;
		const fd = new FormData();
		fd.set('id', id);
		await fetch('?/deletePreset', { method: 'POST', body: fd });
		location.reload();
	}

	const allPresets = $derived([...BUILTIN_PRESETS, ...userPresets]);

	// Typed accessors for enabled effects
	const pit = $derived(effects.pitch as PitchConfig | undefined);
	const tem = $derived(effects.tempo as TempoConfig | undefined);
	const lp = $derived(effects.lowpass as LowpassConfig | undefined);
	const hp = $derived(effects.highpass as HighpassConfig | undefined);
	const bp = $derived(effects.bandpass as BandpassConfig | undefined);
	const ph = $derived(effects.phaser as PhaserConfig | undefined);
	const fl = $derived(effects.flanger as FlangerConfig | undefined);
	const bc = $derived(effects.bitcrusher as BitCrusherConfig | undefined);
	const rm = $derived(effects.ring_mod as RingModConfig | undefined);
	const dl = $derived(effects.delay as DelayConfig | undefined);
	const rv = $derived(effects.reverb as ReverbConfig | undefined);

	const statusLabel = $derived(
		saveStatus === 'saving' ? '…' : saveStatus === 'saved' ? '✓' : saveStatus === 'error' ? '!' : ''
	);
	const statusColor = $derived(
		saveStatus === 'saved' ? 'text-green-400' : saveStatus === 'error' ? 'text-red-400' : 'text-zinc-500'
	);
</script>

<div class="space-y-5">
	<!-- Preset strip -->
	<div>
		<div class="mb-2 flex items-center justify-between">
			<span class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Presets</span>
			{#if saveStatus !== 'idle'}
				<span class="text-xs {statusColor}">{statusLabel} auto-saved</span>
			{/if}
		</div>
		<div class="flex gap-1.5 flex-wrap">
			{#each allPresets as p (p.id)}
				<div class="flex items-center gap-0.5">
					<button
						onclick={() => loadPreset(p)}
						class="rounded px-2 py-1 text-xs font-medium transition-colors {p.is_builtin
							? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
							: 'bg-cyan-900/40 text-cyan-300 hover:bg-cyan-900/70'}"
					>
						{p.name}
					</button>
					{#if !p.is_builtin}
						<button
							onclick={() => deletePreset(p.id)}
							class="rounded px-1 py-1 text-xs text-zinc-600 hover:text-red-400"
							title="Delete preset">×</button
						>
					{/if}
				</div>
			{/each}
		</div>
		<!-- Save as preset -->
		<div class="mt-2 flex items-center gap-2">
			<input
				bind:value={newPresetName}
				placeholder="New preset name…"
				class="input-field h-7 flex-1 text-xs"
				onkeydown={(e) => e.key === 'Enter' && saveAsPreset()}
			/>
			<button
				onclick={saveAsPreset}
				disabled={!newPresetName.trim() || savingPreset}
				class="btn-ghost h-7 px-2 text-xs disabled:opacity-40">Save</button
			>
		</div>
	</div>

	<!-- Pill row: toggle effects on/off -->
	<div>
		<span class="mb-2 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
			>Effects</span
		>
		<div class="flex flex-wrap gap-1.5">
			{#each EFFECT_KEYS as key (key)}
				<button
					onclick={() => toggle(key)}
					class="rounded-full px-3 py-1 text-xs font-semibold border transition-colors {isOn(key)
						? 'border-cyan-400 bg-cyan-400 text-black'
						: 'border-zinc-600 bg-transparent text-zinc-400 hover:border-zinc-400 hover:text-zinc-200'} {key === 'reverse'
						? isOn(key)
							? '!bg-orange-400 !border-orange-400'
							: '!border-orange-700 !text-orange-500 hover:!border-orange-500'
						: ''}"
				>
					{LABELS[key]}
				</button>
			{/each}
		</div>
	</div>

	<!-- Effect control cards (only for enabled effects) -->
	{#if isOn('pitch') && pit}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Pitch</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Semitones: {pit.semitones > 0 ? '+' : ''}{pit.semitones ?? 0}</span>
				<input type="range" min="-24" max="24" step="1"
					value={pit.semitones ?? 0}
					oninput={(e) => patch('pitch', { semitones: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Window: {(pit.window_size ?? 0.1).toFixed(2)}s</span>
				<input type="range" min="0.03" max="0.5" step="0.01"
					value={pit.window_size ?? 0.1}
					oninput={(e) => patch('pitch', { window_size: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('tempo') && tem}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Tempo</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Rate: {(tem.rate ?? 1).toFixed(2)}×</span>
				<input type="range" min="0.25" max="4" step="0.05"
					value={tem.rate ?? 1}
					oninput={(e) => patch('tempo', { rate: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('lowpass') && lp}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Lowpass Filter</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Freq: {Math.round(lp.frequency ?? 1000)} Hz</span>
				<input type="range" min="20" max="20000" step="10"
					value={lp.frequency ?? 1000}
					oninput={(e) => patch('lowpass', { frequency: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Q: {(lp.q ?? 1).toFixed(1)}</span>
				<input type="range" min="0.1" max="20" step="0.1"
					value={lp.q ?? 1}
					oninput={(e) => patch('lowpass', { q: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('highpass') && hp}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Highpass Filter</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Freq: {Math.round(hp.frequency ?? 300)} Hz</span>
				<input type="range" min="20" max="20000" step="10"
					value={hp.frequency ?? 300}
					oninput={(e) => patch('highpass', { frequency: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Q: {(hp.q ?? 1).toFixed(1)}</span>
				<input type="range" min="0.1" max="20" step="0.1"
					value={hp.q ?? 1}
					oninput={(e) => patch('highpass', { q: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('bandpass') && bp}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Bandpass Filter</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Freq: {Math.round(bp.frequency ?? 800)} Hz</span>
				<input type="range" min="20" max="20000" step="10"
					value={bp.frequency ?? 800}
					oninput={(e) => patch('bandpass', { frequency: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Width: {bp.width ?? 12} st</span>
				<input type="range" min="1" max="48" step="1"
					value={bp.width ?? 12}
					oninput={(e) => patch('bandpass', { width: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Mod rate: {(bp.mod_rate_hz ?? 0).toFixed(2)} Hz</span>
				<input type="range" min="0" max="4" step="0.05"
					value={bp.mod_rate_hz ?? 0}
					oninput={(e) => patch('bandpass', { mod_rate_hz: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('phaser') && ph}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Phaser</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Sweep: {(ph.frequency ?? 1).toFixed(1)} Hz</span>
				<input type="range" min="0.1" max="10" step="0.1"
					value={ph.frequency ?? 1}
					oninput={(e) => patch('phaser', { frequency: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Depth: {(ph.depth ?? 0.5).toFixed(2)}</span>
				<input type="range" min="0" max="1" step="0.01"
					value={ph.depth ?? 0.5}
					oninput={(e) => patch('phaser', { depth: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Stages: {ph.stages ?? 4}</span>
				<input type="range" min="2" max="12" step="2"
					value={ph.stages ?? 4}
					oninput={(e) => patch('phaser', { stages: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Feedback: {(ph.feedback ?? 0.5).toFixed(2)}</span>
				<input type="range" min="0" max="0.95" step="0.01"
					value={ph.feedback ?? 0.5}
					oninput={(e) => patch('phaser', { feedback: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('flanger') && fl}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Flanger</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">LFO: {(fl.frequency ?? 1).toFixed(2)} Hz</span>
				<input type="range" min="0.1" max="5" step="0.05"
					value={fl.frequency ?? 1}
					oninput={(e) => patch('flanger', { frequency: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Depth: {(fl.depth ?? 0.5).toFixed(2)}</span>
				<input type="range" min="0" max="1" step="0.01"
					value={fl.depth ?? 0.5}
					oninput={(e) => patch('flanger', { depth: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Feedback: {(fl.feedback ?? 0.3).toFixed(2)}</span>
				<input type="range" min="0" max="0.9" step="0.01"
					value={fl.feedback ?? 0.3}
					oninput={(e) => patch('flanger', { feedback: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Delay: {(fl.delay_time ?? 5).toFixed(0)} ms</span>
				<input type="range" min="1" max="20" step="0.5"
					value={fl.delay_time ?? 5}
					oninput={(e) => patch('flanger', { delay_time: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('bitcrusher') && bc}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">BitCrusher</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Bits: {bc.bits ?? 8}</span>
				<input type="range" min="1" max="16" step="1"
					value={bc.bits ?? 8}
					oninput={(e) => patch('bitcrusher', { bits: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('ring_mod') && rm}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Ring Modulator</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Freq: {Math.round(rm.frequency ?? 100)} Hz</span>
				<input type="range" min="1" max="2000" step="1"
					value={rm.frequency ?? 100}
					oninput={(e) => patch('ring_mod', { frequency: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('delay') && dl}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Delay</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Time: {(dl.time ?? 0.3).toFixed(2)}s</span>
				<input type="range" min="0.01" max="1" step="0.01"
					value={dl.time ?? 0.3}
					oninput={(e) => patch('delay', { time: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Feedback: {(dl.feedback ?? 0.4).toFixed(2)}</span>
				<input type="range" min="0" max="0.95" step="0.01"
					value={dl.feedback ?? 0.4}
					oninput={(e) => patch('delay', { feedback: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Wet: {(dl.wet ?? 0.5).toFixed(2)}</span>
				<input type="range" min="0" max="1" step="0.01"
					value={dl.wet ?? 0.5}
					oninput={(e) => patch('delay', { wet: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('reverb') && rv}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3 space-y-2">
			<h4 class="text-xs font-semibold text-cyan-400">Reverb</h4>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Decay: {(rv.decay ?? 2.5).toFixed(1)}s</span>
				<input type="range" min="0.1" max="10" step="0.1"
					value={rv.decay ?? 2.5}
					oninput={(e) => patch('reverb', { decay: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Pre-delay: {(rv.pre_delay ?? 0.01).toFixed(2)}s</span>
				<input type="range" min="0" max="0.5" step="0.005"
					value={rv.pre_delay ?? 0.01}
					oninput={(e) => patch('reverb', { pre_delay: +e.currentTarget.value })}
					class="flex-1" />
			</label>
			<label class="flex items-center gap-3 text-xs text-zinc-400">
				<span class="w-28">Wet: {(rv.wet ?? 0.5).toFixed(2)}</span>
				<input type="range" min="0" max="1" step="0.01"
					value={rv.wet ?? 0.5}
					oninput={(e) => patch('reverb', { wet: +e.currentTarget.value })}
					class="flex-1" />
			</label>
		</div>
	{/if}

	{#if isOn('reverse')}
		<div class="rounded-lg border border-orange-900/50 bg-zinc-900 p-3">
			<h4 class="text-xs font-semibold text-orange-400">Reverse</h4>
			<p class="mt-1 text-xs text-zinc-500">Audio plays backward. No additional controls.</p>
		</div>
	{/if}

	{#if isOn('robot_voice')}
		<div class="rounded-lg border border-cyan-900/50 bg-zinc-900 p-3">
			<h4 class="text-xs font-semibold text-cyan-400">Robot Voice</h4>
			<p class="mt-1 text-xs text-zinc-500">
				Preset: Ring Mod 30 Hz + BitCrusher 4-bit + Highpass 200 Hz. Customize by toggling those
				effects individually.
			</p>
		</div>
	{/if}

	<!-- Audio previews -->
	{#if previewSrc}
		<div class="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
			<div>
				<p class="mb-1 text-xs text-zinc-500">Original (dry)</p>
				<!-- svelte-ignore a11y_media_has_caption -->
				<audio src={previewSrc} controls class="h-8 w-full" crossorigin="anonymous"></audio>
			</div>
			<div>
				<p class="mb-1 text-xs text-zinc-500">With effects (wet)</p>
				<Waveform src={previewSrc} {effects} height={56} progressColor="#00e5ff" waveColor="#1e3a3a" />
			</div>
		</div>
	{/if}
</div>
