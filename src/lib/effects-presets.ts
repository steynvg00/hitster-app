import type { EffectsConfig, EffectPreset } from '$lib/types/index.js';

export const BUILTIN_PRESETS: EffectPreset[] = [
	{
		id: 'builtin-underwater',
		name: 'Underwater',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			lowpass: { enabled: true, frequency: 600, q: 1.5 },
			reverb: { enabled: true, decay: 3, pre_delay: 0.02, wet: 0.6 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-radio',
		name: 'Radio',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			highpass: { enabled: true, frequency: 300, q: 1 },
			lowpass: { enabled: true, frequency: 3500, q: 1 },
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
			lowpass: { enabled: true, frequency: 8000, q: 0.5 },
			highpass: { enabled: true, frequency: 80, q: 0.7 },
			bandpass: { enabled: true, frequency: 1200, width: 24, mod_rate_hz: 0.1 },
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
			robot_voice: { enabled: true }
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
			reverb: { enabled: true, decay: 4, pre_delay: 0.05, wet: 0.5 },
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
			lowpass: { enabled: true, frequency: 1500, q: 0.8 },
			reverb: { enabled: true, decay: 5, pre_delay: 0.1, wet: 0.75 },
			delay: { enabled: true, time: 0.15, feedback: 0.3, wet: 0.3 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-cathedral',
		name: 'Cathedral',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			reverb: { enabled: true, decay: 8, pre_delay: 0.08, wet: 0.85 },
			delay: { enabled: true, time: 0.4, feedback: 0.45, wet: 0.4 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-phaser-crank',
		name: 'Phaser Crank',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			phaser: { enabled: true, frequency: 4, depth: 0.9, stages: 8, feedback: 0.7, stereo_offset: 0.02 }
		} satisfies EffectsConfig
	},
	{
		id: 'builtin-echo-wall',
		name: 'Echo Wall',
		is_builtin: true,
		created_by: null,
		created_at: '',
		effects: {
			delay: { enabled: true, time: 0.5, feedback: 0.7, wet: 0.6 },
			reverb: { enabled: true, decay: 2, pre_delay: 0.02, wet: 0.3 }
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
			reverb: { enabled: true, decay: 3, pre_delay: 0.03, wet: 0.4 }
		} satisfies EffectsConfig
	}
];

export function getBuiltinPreset(id: string): EffectPreset | undefined {
	return BUILTIN_PRESETS.find((p) => p.id === id);
}
