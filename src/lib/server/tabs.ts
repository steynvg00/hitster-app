import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

// ─── Tab aanmaken — race-veilig ──────────────────────────────────────────────
//
// De ?/addTab-actie deed read-max-then-insert: lees de hoogste positie, voeg
// max+1 toe. Twee requests die elkaar kruisen (een dubbele klik op "+ Add Tab";
// op Icons lagen ze 2 ms uit elkaar) lezen dezelfde max en schrijven dezelfde
// positie. Zonder unieke constraint slaagden beide, en omdat het scoren
// concepten op String(tab.position) keyt, kreeg één van de twee tabs altijd het
// concept van de ander — dus 0 punten, voor ieder team, elke keer.
//
// Twee lagen, allebei nodig:
//   1. Migratie 0081 maakt (challenge_id, position) UNIEK. De database weigert
//      de tweede insert met 23505. Dat is de bron van waarheid.
//   2. Deze functie vangt die 23505 op en probeert met de volgende positie
//      opnieuw, zodat de tweede klik een tab op positie N+1 oplevert in plaats
//      van een 500 voor de host.
//
// De read-max blijft als startpunt (goedkoop, meestal meteen raak); de
// constraint is wat het correct maakt, de retry wat het bruikbaar maakt.
// Gepind door tests/bots/verify-tab-position-race.ts.

export const TAB_INSERT_MAX_ATTEMPTS = 5;

const UNIQUE_VIOLATION = '23505';

export type CreateTabResult =
	| { ok: true; tabId: string; position: number }
	| { ok: false; error: string };

export async function createTab(
	db: SupabaseClient<Database>,
	challengeId: string,
	createdBy: string | null
): Promise<CreateTabResult> {
	const { data: existing } = await db
		.from('challenge_tabs')
		.select('position')
		.eq('challenge_id', challengeId)
		.order('position', { ascending: false })
		.limit(1);

	let position = (existing?.[0]?.position ?? -1) + 1;

	for (let attempt = 0; attempt < TAB_INSERT_MAX_ATTEMPTS; attempt++) {
		const { data: newTab, error } = await db
			.from('challenge_tabs')
			.insert({ challenge_id: challengeId, position, created_by: createdBy })
			.select('id')
			.single();

		if (!error && newTab) return { ok: true, tabId: newTab.id, position };

		// Alleen een unique violation is een race; al het andere is een echte fout.
		if (error?.code !== UNIQUE_VIOLATION) {
			return { ok: false, error: error?.message ?? 'Could not create tab' };
		}
		position++;
	}

	return {
		ok: false,
		error: `Could not find a free tab position after ${TAB_INSERT_MAX_ATTEMPTS} attempts`
	};
}
