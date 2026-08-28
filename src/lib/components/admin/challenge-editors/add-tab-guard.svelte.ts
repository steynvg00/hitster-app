import type { SubmitFunction } from '@sveltejs/kit';

// ─── Dubbelklik-guard voor "+ Add Tab" ───────────────────────────────────────
//
// De eerste van drie lagen tegen de dubbele-tabpositie-bug (Icons, 17 juli 2026:
// twee ?/addTab-requests 2 ms uit elkaar kregen allebei positie 6, en omdat het
// scoren concepten op String(tab.position) keyt, scoorde één van de twee tabs
// daarna altijd 0 punten voor elk team).
//
// De drie lagen, van voor naar achter:
//   1. deze guard          een tweede submit terwijl de eerste nog loopt wordt
//                          geannuleerd — `use:enhance` doet dat niet vanzelf
//   2. migratie 0081       UNIQUE (challenge_id, position) — de bron van waarheid
//   3. createTab()         vangt de 23505 die (2) teruggeeft en probeert de
//                          volgende positie ($lib/server/tabs)
//
// Alleen (2) maakt het correct; (1) en (3) maken het bruikbaar. Deze laag staat
// in ÉÉN module in plaats van vier keer in de vier variant-editors, omdat vier
// kopieën van dezelfde 15 regels precies de drift is waar de rest van deze
// codebase (zie $lib/threshold, $lib/powerups-meta) op is ingericht.
//
// Runes in een los bestand vereisen de `.svelte.ts`-extensie — vandaar de naam.

/**
 * Maak één guard voor één formulier. Elke editor roept dit één keer aan op
 * componentniveau; de `$state` hoort bij dat ene formulier, dus twee editors
 * (of twee formulieren) delen nooit dezelfde vlag.
 *
 * Gebruik: `<form method="POST" action="?/addTab" use:enhance={guardAddTab}>`
 */
export function createAddTabGuard(): SubmitFunction {
	let submitting = $state(false);

	return ({ cancel }) => {
		if (submitting) {
			// De tweede klik doet niets: geen request, geen tweede tab.
			cancel();
			return;
		}
		submitting = true;
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	};
}
