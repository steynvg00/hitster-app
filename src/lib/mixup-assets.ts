/**
 * M!XUP redesign — statische assets.
 *
 * ── WebP-versies (`-v2`) ─────────────────────────────────────────────────────
 * De PNG-originelen werden geladen op een veelvoud van hun weergavemaat: het
 * slotje was 550.912 bytes voor 22x27 CSS-px, de zes challenge-logo's samen
 * 5,5 MB voor balkjes van 150 px breed. Elk `-v2.webp` is geschaald naar de
 * werkelijke weergavemaat op 3x DPR en hergecodeerd als WebP met alpha —
 * samen 10.673.548 -> 565.564 bytes.
 *
 * De NIEUWE bestandsnaam is opzettelijk: hij omzeilt elke cache die de oude PNG
 * nog vasthoudt, en maakt daarmee een lange `max-age` op /uploads/* veilig (zie
 * vercel.json). De PNG-originelen blijven voorlopig staan als terugvalpad.
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
	crown: `${BASE}/Kroon-v2.webp`,
	/** Plek 2. Slot 108x174, top -78. */
	silver: `${BASE}/icon_rank2_silver-v2.webp`,
	/** Plek 3. Slot 108x174, top -78. */
	bronze: `${BASE}/icon_rank3_bronze-v2.webp`,
	/** Plek 4 en lager. Slot 108x174, top -78. */
	dark: `${BASE}/icon_rank4plus_dark-v2.webp`,
	/** Watermerk op de plek-1-kaart: 96% breedte, multiply, blur 2px. */
	supreme: `${BASE}/Supreme-v2.webp`
} as const;

/** Losse UI-iconen (PNG-assets, geen lucide). */
export const ICON_ASSETS = {
	/** Teamfoto-icoon in de lobby, 38px in een 56px squircle. */
	camera: `${BASE}/icon_camera-v2.webp`,
	/** Vergrendelde challenge, 22x27, rechts van het challenge-logo. */
	lock: `${BASE}/icon_lock-v2.webp`,
	/** "Telefoon weg" — ceremonie/grote scherm. */
	noPhone: `${BASE}/icon_no_phone_transparent.png`,
	/** Randomizer, rolt in diceRoll 0.7s. */
	dice: `${BASE}/icon-dobbelsteen-v2.webp`,
	/** Tussenscherm-kristal, 110px + drop-shadow glow. */
	headphones: `${BASE}/icon-koptelefoon-e5e908a1.png`,
	/** Tussenscherm-kristal, 110px + drop-shadow glow. */
	finishFlag: `${BASE}/icon-finish-flag-91b77f93.png`
} as const;

/** Challenge-logo's, met de hoogtes uit de designspec (links uitgelijnd, max-width 150px). */
export const CHALLENGE_LOGOS = {
	hitster: { src: `${BASE}/hitster1-v2.webp`, height: 31 },
	anthems: { src: `${BASE}/anthems-v2.webp`, height: 39 },
	icons: { src: `${BASE}/icons-v2.webp`, height: 23 },
	effects: { src: `${BASE}/effects-v2.webp`, height: 28 },
	fragments: { src: `${BASE}/fragments-v2.webp`, height: 44 },
	mashups: { src: `${BASE}/mashups-v2.webp`, height: 24 }
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

/**
 * Bestandsnamen in `static/uploads/Powerups/` die NIET gelijk zijn aan het
 * `powerup_types.id` waar ze bij horen. Alleen een naam-alias — de id blijft
 * overal wat hij is.
 */
const POWERUP_ICON_ALIAS: Record<string, string> = {
	power_spin: 'powerspin'
};

/** Powerup-icoon voor een powerup-type-id (zie powerup_types.id). */
export function powerupIcon(typeId: string): string {
	return `${BASE}/Powerups/${POWERUP_ICON_ALIAS[typeId] ?? typeId}.png`;
}

/**
 * De iconen waar de slotmachine (scherm 5) doorheen rolt vóór hij landt.
 * Puur decor: welke powerup je wint is al door de server bepaald voordat dit
 * scherm opent. Dezelfde vijf als in de designbron.
 */
export const SLOT_REEL_ICON_IDS = ['freeze', 'x_ray', 'shield', 'power_spin', 'lifeline'] as const;
