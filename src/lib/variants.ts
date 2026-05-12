import * as LucideIcons from 'lucide-svelte';

export const VARIANTS = [
	'normal',
	'label',
	'anthem',
	'vocal',
	'fragments',
	'kick',
	'mashup',
	'battle'
] as const;

export type ChallengeVariant = (typeof VARIANTS)[number];

const VARIANT_ICON: Record<string, string> = {
	normal: 'Music',
	label: 'Disc',
	anthem: 'Flag',
	vocal: 'Mic',
	fragments: 'Puzzle',
	kick: 'Activity',
	mashup: 'Shuffle',
	battle: 'Swords'
};

const VARIANT_COLOR: Record<string, string> = {
	normal: 'bg-blue-900/60 text-blue-400',
	label: 'bg-purple-900/60 text-purple-400',
	anthem: 'bg-green-900/60 text-green-400',
	vocal: 'bg-pink-900/60 text-pink-400',
	fragments: 'bg-orange-900/60 text-orange-400',
	kick: 'bg-red-900/60 text-red-400',
	mashup: 'bg-yellow-900/60 text-yellow-400',
	battle: 'bg-amber-900/60 text-amber-400'
};

export function getVariantIcon(variant: string): typeof LucideIcons.Music {
	const name = VARIANT_ICON[variant] ?? 'HelpCircle';
	return (LucideIcons as Record<string, unknown>)[name] as typeof LucideIcons.Music;
}

export function getVariantColor(variant: string): string {
	return VARIANT_COLOR[variant] ?? 'bg-zinc-700 text-zinc-400';
}
