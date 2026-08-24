/**
 * `use:portal` — hangt een overlay-element rechtstreeks onder <body>.
 *
 * Waarom dit nodig is: `position: fixed` valt NIET terug op het viewport
 * zodra een voorouder een `filter`, `backdrop-filter`, `transform`,
 * `perspective`, `contain` of `will-change` heeft — dan wordt die voorouder
 * het bevattende blok. De powerup-overlays worden gerenderd binnen
 * HeldPowerups, en op /team staat die component in een `.hub-card` mét
 * `backdrop-filter: blur(14px)`. Het "fixed inset-0"-scherm kromp daardoor
 * tot het kaartje zelf (gemeten: 312x81 in plaats van 390x844), waardoor de
 * modal een samengeperst scrollvakje werd.
 *
 * Door het element naar <body> te verplaatsen is er per definitie geen
 * voorouder meer die het bevattende blok kan kapen — waar de aanroeper de
 * component ook neerzet.
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
}
