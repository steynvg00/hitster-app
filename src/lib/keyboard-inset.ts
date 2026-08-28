/**
 * HOEVEEL VAN HET SCHERM HET TOETSENBORD BEDEKT, als pure rekensom.
 *
 * Eén lezer: de powerup-balk op scherm 7B (challenge/[id]/+page.svelte). Die
 * balk moet zichtbaar zijn zolang er gespeeld wordt en weg zodra er getypt
 * wordt — met het toetsenbord open stond hij anders midden over het
 * antwoordveld heen.
 *
 * ── WAAROM DIT EEN EIGEN BESTAND IS ──────────────────────────────────────────
 *
 * De som stond in een onMount tussen twee visualViewport-listeners in, en was
 * daarmee alleen op een echt toestel met een echt toetsenbord te controleren.
 * Dat is precies de reden dat de fout hieronder twee keer kon terugkomen: er is
 * geen enkele manier om hem in een browser zonder toetsenbord te zien. Als
 * losse functie is het een tabel van drie getallen naar één getal, en pint
 * tests/bots/verify-keyboard-inset.ts de gevallen waar het misging.
 *
 * ── DE FOUT DIE HIER ZAT ─────────────────────────────────────────────────────
 *
 * De oude som was:
 *
 *     bedekt = innerHeight - vv.height - vv.offsetTop
 *
 * `offsetTop` is hoe ver het VISUELE viewport binnen het layout-viewport naar
 * beneden geschoven is. iOS Safari zet dat zelf wanneer een invoerveld anders
 * achter het toetsenbord zou vallen — en op DIT scherm is dat de normale gang
 * van zaken, want de pagina zelf kan niet scrollen (html.mixup-geen-paginascroll
 * → overflow: hidden). Safari kan het veld dus niet in beeld scrollen en
 * verschuift in plaats daarvan het visuele viewport.
 *
 * Hoe LAGER het veld op het scherm, hoe groter die verschuiving, en hoe kleiner
 * de uitkomst van de oude som. Uitgerekend met de toestelmaten uit dit project
 * (layout-viewport 754, toetsenbord 336):
 *
 *   veld bovenin    offsetTop   0 →  754 - 418 -   0 = 336  > 80  ✔ verborgen
 *   veld halverwege offsetTop 150 →  754 - 418 - 150 = 186  > 80  ✔ verborgen
 *   veld onderin    offsetTop 300 →  754 - 418 - 300 =  36  < 80  ✘ ZICHTBAAR
 *
 * In dat laatste geval bleef de balk staan op `bottom: 10px` van het
 * scrollgebied. Dat scrollgebied eindigt aan de onderrand van het LAYOUT-
 * viewport (714), en die zit na een verschuiving van 300px op visuele hoogte
 * 414 — de bovenrand van het toetsenbord. Vandaar het beeld: de pil zweeft
 * precies bovenop het toetsenbord, over het antwoordveld heen.
 *
 * Dat verklaart ook waarom het "soms wel goed" leek: bij een veld bovenaan de
 * kaart is de verschuiving klein en werkt de drempel gewoon.
 *
 * ── DE SOM DIE HIER NU STAAT ─────────────────────────────────────────────────
 *
 * `innerHeight - vv.height`, zonder offsetTop. Dat is de hoogte van het
 * toetsenbord zelf, en die hangt niet af van waar het veld staat. Verschuiven
 * verandert WAAR je door het layout-viewport kijkt, niet HOEVEEL ervan bedekt
 * is; offsetTop hoorde dus nooit in deze som.
 *
 * De uitkomst is ook de schuifafstand van de verbergstand
 * (`translateY(calc(100% + var(--kb-inset)))`). Daar mag hij ruim zijn — te ver
 * naar beneden is nog steeds uit beeld — en de volle toetsenbordhoogte is per
 * constructie genoeg.
 */

/**
 * De drempel waaronder een bedekking geen toetsenbord is.
 *
 * Op iOS rapporteert `window.innerHeight` het GROTE viewport en volgt
 * `visualViewport.height` de adresbalk. Met de balk uitgeklapt scheelt dat op de
 * toestelmaten van dit project 754 - 714 = 40px, en dat verschil verschijnt en
 * verdwijnt tijdens het scrollen. Zonder drempel zou de balk daarvan gaan
 * wiebelen. Een toetsenbord is een veelvoud daarvan (~300px en meer), dus 80px
 * ligt ruim tussen de twee in.
 */
export const TOETSENBORD_DREMPEL_PX = 80;

export type ViewportMaten = {
	/** window.innerHeight — het layout-viewport, dat het toetsenbord niet krimpt. */
	innerHeight: number;
	/** visualViewport.height — wat er werkelijk zichtbaar van over is. */
	viewportHeight: number;
};

/**
 * Hoeveel pixels van het layout-viewport het toetsenbord bedekt. Nooit negatief.
 *
 * `visualViewport.offsetTop` komt hier bewust NIET in voor — zie de kop van dit
 * bestand.
 */
export function toetsenbordBedekking({ innerHeight, viewportHeight }: ViewportMaten): number {
	return Math.max(0, innerHeight - viewportHeight);
}

/** Staat het toetsenbord open? Alles boven de drempel telt als toetsenbord. */
export function toetsenbordOpenBij(bedekking: number): boolean {
	return bedekking > TOETSENBORD_DREMPEL_PX;
}
