import type { EffectsConfig, EffectPreset } from '$lib/types/index.js';

export const BUILTIN_PRESETS: EffectPreset[] = [
	{
		id: 'builtin-underwater',
		name: 'Underwater',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			lowpass: { enabled: true, cutoff_hz: 600, q: 1.5 },
			reverb: { enabled: true, decay_s: 3, pre_delay_ms: 20, wet: 0.6 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-radio',
		name: 'Radio',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			highpass: { enabled: true, cutoff_hz: 300, q: 1 },
			lowpass: { enabled: true, cutoff_hz: 3500, q: 1 },
			bitcrusher: { enabled: true, bits: 10 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-8bit',
		name: '8-Bit Game',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			bitcrusher: { enabled: true, bits: 4 },
			pitch: { enabled: true, semitones: 5, window_size: 0.1 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-vinyl',
		name: 'Vinyl',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			lowpass: { enabled: true, cutoff_hz: 8000, q: 0.5 },
			highpass: { enabled: true, cutoff_hz: 80, q: 0.7 },
			bandpass: { enabled: true, freq_hz: 1200, q: 1.4, mod_rate_hz: 0.1 },
			bitcrusher: { enabled: true, bits: 12 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-robot-voice',
		name: 'Robot Voice',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			ring_mod: { enabled: true, freq_hz: 30, depth: 1 },
			bitcrusher: { enabled: true, bits: 4 },
			highpass: { enabled: true, cutoff_hz: 200, q: 1 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-reverse',
		name: 'Reverse',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			reverse: { enabled: true }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-reverse-dream',
		name: 'Reverse Dream',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			reverse: { enabled: true },
			reverb: { enabled: true, decay_s: 4, pre_delay_ms: 50, wet: 0.5 },
			pitch: { enabled: true, semitones: -3, window_size: 0.15 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-far-away',
		name: 'Far Away',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			lowpass: { enabled: true, cutoff_hz: 1500, q: 0.8 },
			reverb: { enabled: true, decay_s: 5, pre_delay_ms: 100, wet: 0.75 },
			delay: { enabled: true, time_ms: 150, feedback: 0.3, wet: 0.3 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-cathedral',
		name: 'Cathedral',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			reverb: { enabled: true, decay_s: 8, pre_delay_ms: 80, wet: 0.85 },
			delay: { enabled: true, time_ms: 400, feedback: 0.45, wet: 0.4 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-phaser-crank',
		name: 'Phaser Crank',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			phaser: {
				enabled: true,
				rate_hz: 4,
				depth: 0.9,
				stages: 8,
				feedback: 0.7
			}
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-echo-wall',
		name: 'Echo Wall',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			delay: { enabled: true, time_ms: 500, feedback: 0.7, wet: 0.6 },
			reverb: { enabled: true, decay_s: 2, pre_delay_ms: 20, wet: 0.3 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-mangled',
		name: 'Mangled',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			pitch: { enabled: true, semitones: -7, window_size: 0.25 },
			tempo: { enabled: true, rate: 0.6 },
			bitcrusher: { enabled: true, bits: 6 },
			reverb: { enabled: true, decay_s: 3, pre_delay_ms: 30, wet: 0.4 }
		} satisfies EffectsConfig
	}
];

export function getBuiltinPreset(id: string): EffectPreset | undefined {
	return BUILTIN_PRESETS.find((p) => p.id === id);
}
