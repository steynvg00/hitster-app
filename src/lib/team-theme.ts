/**
 * Teamkleuren voor de speler-UI (redesign fase 2).
 *
 * De hex-waardes zijn dezelfde als de `--color-team-*` tokens in
 * src/routes/layout.css; deze module bestaat omdat inline styles (glows,
 * gradients, box-shadows met alpha-suffix) een JS-waarde nodig hebben.
 * Bron: design_handoff_mixup_redesign/README.md § Teamkleuren.
 */
import type { TeamColor } from '$lib/types';

export const TEAM_HEX: Record<TeamColor, string> = {
	blue: '#2E7BFF',
	yellow: '#FFE600',
	green: '#2BD97A',
	red: '#FF3B4A',
	indigo: '#7C4DFF',
	black: '#171A2B'
};

/**
 * Glowkleur. Zwart krijgt bewust een WITTE glow i.p.v. zijn eigen kleur —
 * anders is er geen zichtbare gloed op een donkere achtergrond.
 */
export const TEAM_GLOW: Record<TeamColor, string> = {
	blue: '#2E7BFF',
	yellow: '#FFE600',
	green: '#2BD97A',
	red: '#FF3B4A',
	indigo: '#7C4DFF',
	black: 'rgba(255,255,255,0.85)'
};

/** Tekstkleur bovenop een vlak in de teamkleur. Geel is te licht voor wit. */
export const TEAM_ON_COLOR: Record<TeamColor, string> = {
	blue: '#FFFFFF',
	yellow: '#1A1400',
	green: '#0B0B1F',
	red: '#FFFFFF',
	indigo: '#FFFFFF',
	black: '#FFFFFF'
};

export function teamHex(color: string | null | undefined): string {
	return TEAM_HEX[color as TeamColor] ?? TEAM_HEX.blue;
}

export function teamGlow(color: string | null | undefined): string {
	return TEAM_GLOW[color as TeamColor] ?? TEAM_GLOW.blue;
}

export function teamOnColor(color: string | null | undefined): string {
	return TEAM_ON_COLOR[color as TeamColor] ?? '#FFFFFF';
}

/** Bannerverloop achter "JOUW TEAM …" / "JIJ BENT …". */
export function teamBanner(color: string | null | undefined): string {
	const c = teamHex(color);
	return `linear-gradient(135deg, ${c} 0%, ${c}AA 100%)`;
}
