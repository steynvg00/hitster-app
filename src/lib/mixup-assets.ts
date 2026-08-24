/**
 * M!XUP redesign — statische assets.
 *
 * Eén bron van waarheid voor alle paden naar `static/uploads/`. Gebruik deze
 * constanten i.p.v. losse strings, zodat een hernoemd bestand op één plek
 * wijzigt (en bestandsnamen met spaties correct ge-encodeerd blijven).
 *
 * Bron: design_handoff_mixup_redesign/README.md § Assets.
 */

const BASE = '/uploads';

/** Het ENIGE toegestane M!XUP-logo — vervangt drip/shatter overal. */
export const MIXUP_LOGO = `${BASE}/mixup_spin_clean.png`;

/** Rang-assets voor de eindstand-schermen (11H) en het podium. */
export const RANK_ASSETS = {
	/** Plek 1. Slot 202x294, top -130. */
	crown: `${BASE}/Kroon-v1.2.png`,
	/** Plek 2. Slot 108x174, top -78. */
	silver: `${BASE}/icon_rank2_silver_transparent.png`,
	/** Plek 3. Slot 108x174, top -78. */
	bronze: `${BASE}/icon_rank3_bronze_transparent.png`,
	/** Plek 4 en lager. Slot 108x174, top -78. */
	dark: `${BASE}/icon_rank4plus_dark_transparent.png`,
	/** Watermerk op de plek-1-kaart: 96% breedte, multiply, blur 2px. */
	supreme: `${BASE}/Supreme.png`
} as const;

/** Losse UI-iconen (PNG-assets, geen lucide). */
export const ICON_ASSETS = {
	/** Teamfoto-icoon in de lobby, 38px in een 56px squircle. */
	camera: `${BASE}/icon_camera_transparent.png`,
	/** Vergrendelde challenge, 22x27, rechts van het challenge-logo. */
	lock: `${BASE}/icon_lock_transparent.png`,
	/** "Telefoon weg" — ceremonie/grote scherm. */
	noPhone: `${BASE}/icon_no_phone_transparent.png`,
	/** Randomizer, rolt in diceRoll 0.7s. */
	dice: `${BASE}/icon-dobbelsteen.png`,
	/** Tussenscherm-kristal, 110px + drop-shadow glow. */
	headphones: `${BASE}/icon-koptelefoon-e5e908a1.png`,
	/** Tussenscherm-kristal, 110px + drop-shadow glow. */
	finishFlag: `${BASE}/icon-finish-flag-91b77f93.png`
} as const;

/** Challenge-logo's, met de hoogtes uit de designspec (links uitgelijnd, max-width 150px). */
export const CHALLENGE_LOGOS = {
	hitster: { src: `${BASE}/hitster1.png`, height: 31 },
	anthems: { src: `${BASE}/anthems%20half.png`, height: 39 },
	icons: { src: `${BASE}/icons.png`, height: 23 },
	effects: { src: `${BASE}/effects.png`, height: 28 },
	fragments: { src: `${BASE}/fragments.png`, height: 44 },
	mashups: { src: `${BASE}/mashups.png`, height: 24 }
} as const;

/** Overlays en achtergronden. */
export const OVERLAY_ASSETS = {
	/** Code-regen tegel — zie CodeRain.svelte. */
	codeRain: `${BASE}/voor-claude-design/overlay-coderain_cyaan.png`,
	/** Kristal-hoeken overlay, opacity 0.35-0.4. */
	frameCorners: `${BASE}/voor-claude-design/frame-hoeken_kristal_alpha.png`,
	lightningArc: `${BASE}/voor-claude-design/effect-lightning-arc_alpha.png`,
	glitchBackground: `${BASE}/voor-claude-design/achtergrond-attention_glitch.jpg`,
	/** Voorbeeld van een gameset-logo (Vriendenweekend 2026). */
	gamesetLogoExample: `${BASE}/voor-claude-design/titel-vriendenweekend-2026_tropisch.jpg`
} as const;

/** Splash rond de teamcirkel bij de randomizer-reveal. */
export const SPLASH_VIDEO = `${BASE}/splash-mixup.mp4`;

/** Powerup-icoon voor een powerup-type-id (zie powerup_types.id). */
export function powerupIcon(typeId: string): string {
	return `${BASE}/Powerups/${typeId}.png`;
}
