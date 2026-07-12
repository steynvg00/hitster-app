import * as LucideIcons from 'lucide-svelte';
import type { ChallengeType } from '$lib/types/index.js';

export const CHALLENGE_TYPES = [
	'standard',
	'anthem',
	'label',
	'mashup',
	'fragments',
	'effects'
] as const satisfies readonly ChallengeType[];

// Keep VARIANTS as an alias for callers that haven't migrated yet
export const VARIANTS = CHALLENGE_TYPES;

export type { ChallengeType };

const TYPE_ICON: Record<ChallengeType, string> = {
	standard: 'Music',
	anthem: 'Flag',
	label: 'Tag',
	mashup: 'Blend',
	fragments: 'Puzzle',
	effects: 'Sliders'
};

const TYPE_COLOR: Record<ChallengeType, string> = {
	standard: 'bg-mixup-cyan/10 text-mixup-cyan',
	anthem: 'bg-mixup-magenta/10 text-mixup-magenta',
	label: 'bg-mixup-yellow/10 text-mixup-yellow',
	mashup: 'bg-mixup-violet/10 text-mixup-violet',
	fragments: 'bg-mixup-orange/10 text-mixup-orange',
	effects: 'bg-green-900/20 text-green-400'
};

const TYPE_DESCRIPTION: Record<ChallengeType, string> = {
	standard: 'Artist · Title · Year',
	anthem: 'Festival · Artist · Title · Year',
	label: 'Label · Artist · Title · Year',
	mashup: 'Pick a mashup; players identify source tracks',
	fragments: 'Numbered clips; players name each source track',
	effects: 'Audio FX chain per tab — artist · title · year'
};

export function getTypeIcon(type: string): typeof LucideIcons.Music {
	const name = TYPE_ICON[type as ChallengeType] ?? 'HelpCircle';
	return (LucideIcons as Record<string, unknown>)[name] as typeof LucideIcons.Music;
}

export function getTypeColor(type: string): string {
	return TYPE_COLOR[type as ChallengeType] ?? 'bg-zinc-700 text-zinc-400';
}

export function getTypeDescription(type: string): string {
	return TYPE_DESCRIPTION[type as ChallengeType] ?? '';
}

// Legacy aliases — callers import these without breaking
export const getVariantIcon = getTypeIcon;
export const getVariantColor = getTypeColor;
