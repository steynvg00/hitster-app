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

/**
 * Het ENIGE toegestane M!XUP-logo — vervangt drip/shatter overal.
 *
 * ── Waarom -v2.webp en niet meer de PNG ─────────────────────────────────────
 * #99 haalde een exportartefact uit dit asset: een film van alfa 1-4 over het
 * hele canvas van 818x297, die tegen de donkere paginagradient las als een
 * lichte rechthoek achter het logo. Die fix zit nog gewoon in het bestand
 * (gemeten op static/uploads/mixup_spin_clean.png: alfa 1-4 = 0,00%), maar de
 * BESTANDSNAAM bleef gelijk — en #104 zette daarna
 * `cache-control: public, max-age=604800` op /uploads/* (vercel.json).
 *
 * Een browser of CDN-edge die de PNG van vóór #99 had, houdt die dus tot een
 * week vast zonder te hervalideren, en dan is de rechthoek terug. Dat is exact
 * de reden die #104 zelf noemt voor de `-v2`-naamgeving: een nieuwe naam
 * omzeilt elke cache. Dit asset had er alleen nog geen gekregen.
 *
 * Dus dezelfde behandeling als batch A: WebP, kwaliteit 88, alphaQuality 100,
 * native pixelmaat behouden (818x297 is op een 402px-scherm bij 3x DPR nog
 * steeds kleiner dan de weergave, dus verkleinen zou hem juist zachter maken).
 * 331.769 -> 123.324 bytes (62,8% minder).
 *
 * GEMETEN op de drie bestanden (canvas getImageData, alfahistogram over alle
 * 242.946 pixels van 818x297):
 *
 *                                              alfa 0    alfa 1-4    alfa 5-20
 *   design_handoff/.../mixup_spin_clean.png     7,13%     42,30%       11,73%
 *   static/uploads/mixup_spin_clean.png        49,42%      0,00%       11,73%
 *   static/uploads/mixup_spin_clean-v2.webp    49,42%      0,00%       11,73%
 *
 * De film is die 42,30%: 102.756 pixels op alfa 1-4, over het HELE canvas tot
 * in de hoeken. #99 duwde precies die pixels naar alfa 0 (7,13% + 42,30% =
 * 49,42%, tot op de pixel). De WebP-hercodering is daarin identiek aan de
 * gerepareerde PNG — de conversie heeft de fix niet aangetast.
 *
 * De resterende 11,73% op alfa 5-20 is GEEN tweede film maar de antialiasing
 * om de letters heen; een 40x15-raster over het canvas laat in -v2.webp overal
 * buiten de letterzone exact 0 zien, waar het handoff-origineel daar juist
 * overal 2-8 heeft.
 *
 * Alle plekken die het logo tonen gaan via deze constante — NfcTapSplash,
 * /leaderboard, /sets/[id]/podium, /play/[mode], /play/waiting en de
 * design-systeempagina. Er staat nergens een los pad naar /uploads/ in de
 * codebase, en app.html heeft geen og:image of manifest die het logo noemt.
 */
export const MIXUP_LOGO = `${BASE}/mixup_spin_clean-v2.webp`;

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
	/**
	 * Kristal-hoeken, vier LOSSE bestanden.
	 *
	 * Was één PNG van 768x1376 met alle vier de hoeken erin, uitgerekt over het
	 * hele vlak — 362.657 bytes waarvan 86,40% alfa 0: bijna negen tiende lege
	 * ruimte die elk scherm meelaadde, en de hoeken waren niet los te plaatsen.
	 *
	 * Elke hoek is nu strak bijgesneden tot zijn eigen inhoud en apart verankerd
	 * in zijn SCHERMhoek (zie PlayerScreen). Zelfde behandeling als batch A:
	 * WebP, kwaliteit 88, alphaQuality 100. Samen 89.186 bytes — 75,4% minder.
	 *
	 * Native pixelmaat behouden, NIET geschaald: de grootste hoek rendert op een
	 * 402px-scherm 175 CSS-px breed, dus 526 device-px op 3x DPR, en het bestand
	 * is 335px. Verkleinen zou hem juist te klein maken.
	 */
	frameCorners: {
		/** 265x288, 17.634 bytes. Inzet vanaf de schermhoek: 1,43% / 0,80%. */
		linksboven: `${BASE}/voor-claude-design/frame-hoek-linksboven-v2.webp`,
		/** 265x287, 18.060 bytes. Inzet: 1,43% / 0,80%. */
		rechtsboven: `${BASE}/voor-claude-design/frame-hoek-rechtsboven-v2.webp`,
		/** 335x428, 26.718 bytes. Sluit aan op de hoek (inzet 0). */
		linksonder: `${BASE}/voor-claude-design/frame-hoek-linksonder-v2.webp`,
		/** 336x427, 26.774 bytes. Sluit aan op de hoek (inzet 0). */
		rechtsonder: `${BASE}/voor-claude-design/frame-hoek-rechtsonder-v2.webp`
	},
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
 *
 * Puur decor: welke powerup je wint is al door de server bepaald voordat dit
 * scherm opent. De rol laat alleen zien DAT er getrokken wordt.
 *
 * Dit waren er vijf — de reeks uit de designbron. Met twintig iconen in
 * static/uploads/Powerups/ betekende dat: bij elke onthulling dezelfde vijf
 * plaatjes in dezelfde volgorde. De rol is nu de VOLLEDIGE set, en het
 * onthulscherm trekt er willekeurig uit, zodat twee onthullingen naast elkaar
 * niet hetzelfde filmpje zijn.
 *
 * Eén rij per bestand in static/uploads/Powerups/, en tegelijk exact de
 * `powerup_types.id`-verzameling — `powerupIcon()` vertaalt de enige naam die
 * afwijkt (power_spin -> powerspin.png) via POWERUP_ICON_ALIAS hierboven.
 */
export const SLOT_REEL_ICON_IDS = [
	'all_seeing_eye',
	'bonus_points',
	'double_down',
	'free_answer',
	'free_tab',
	'freeze',
	'give_a_shot',
	'hard_gaan',
	'insurance',
	'lifeline',
	'lucky_dice',
	'penalty_shot',
	'power_spin',
	'resurrection',
	'shield',
	'single_event_mult',
	'tap_to_break',
	'time_boost',
	'time_drain',
	'x_ray'
] as const;
