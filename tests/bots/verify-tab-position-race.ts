// Tab-positie race — verificatie.
//
//   npm run bots:verify-tab-position-race
//
// Pure harness, geen DB. Pint het gedrag van createTab (src/lib/server/tabs.ts):
// de vervanger van het read-max-then-insert in de ?/addTab-actie.
//
// De bug die dit afdekt (Icons, 17 juli 2026): twee ?/addTab-requests 2 ms na
// elkaar lazen allebei "hoogste positie = 5" en voegden allebei positie 6 toe.
// Geen unieke constraint op (challenge_id, position), dus beide inserts slaagden
// en het scoren — dat concepten op String(tab.position) keyt — gaf één van de
// twee tabs altijd 0 punten. Migratie 0081 voegt de constraint toe; createTab
// vangt de 23505 die de constraint dan teruggeeft op en probeert met de
// volgende positie opnieuw, zodat de tweede klik een tab op positie 7 oplevert
// in plaats van een 500.

import { createTab, TAB_INSERT_MAX_ATTEMPTS } from '../../src/lib/server/tabs';

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
}

/**
 * Minimale db-stub voor precies de twee ketens createTab gebruikt:
 *   from('challenge_tabs').select('position').eq(...).order(...).limit(1)
 *   from('challenge_tabs').insert({...}).select('id').single()
 * `taken` is de set posities die "al bestaan" — een insert daarop geeft de
 * PostgREST-vorm van een unique violation (code 23505), net als de echte
 * constraint. Elke geslaagde insert claimt zijn positie, zodat een tweede
 * createTab in dezelfde stub het echte vervolg ziet.
 */
function makeDb(opts: { taken: Set<number>; maxSeenByRead: number | null }) {
	const inserts: number[] = [];
	const db = {
		from: (_table: string) => ({
			select: (_cols: string) => ({
				eq: () => ({
					order: () => ({
						limit: async () => ({
							data: opts.maxSeenByRead === null ? [] : [{ position: opts.maxSeenByRead }],
							error: null
						})
					})
				})
			}),
			insert: (row: { position: number }) => ({
				select: () => ({
					single: async () => {
						inserts.push(row.position);
						if (opts.taken.has(row.position)) {
							return {
								data: null,
								error: {
									code: '23505',
									message:
										'duplicate key value violates unique constraint "challenge_tabs_challenge_id_position_key"'
								}
							};
						}
						opts.taken.add(row.position);
						return { data: { id: `tab-${row.position}` }, error: null };
					}
				})
			})
		})
	};
	return { db, inserts };
}

// ── 1. Geen race: eerste vrije positie ───────────────────────────────────────
{
	const { db, inserts } = makeDb({ taken: new Set([0, 1, 2]), maxSeenByRead: 2 });
	const r = await createTab(db as never, 'ch', null);
	assert('no race → position max+1', r, { ok: true, tabId: 'tab-3', position: 3 });
	assert('no race → één insert', inserts, [3]);
}

// ── 2. Lege challenge → positie 0 ────────────────────────────────────────────
{
	const { db } = makeDb({ taken: new Set(), maxSeenByRead: null });
	const r = await createTab(db as never, 'ch', null);
	assert('lege challenge → positie 0', r, { ok: true, tabId: 'tab-0', position: 0 });
}

// ── 3. DE RACE: de read zag max 5, maar 6 is intussen door een ander request
//       geclaimd. De constraint weigert 6; createTab moet 7 nemen. ────────────
{
	const { db, inserts } = makeDb({ taken: new Set([0, 1, 2, 3, 4, 5, 6]), maxSeenByRead: 5 });
	const r = await createTab(db as never, 'ch', null);
	assert('race → schuift door naar 7', r, { ok: true, tabId: 'tab-7', position: 7 });
	assert('race → 6 geprobeerd, toen 7', inserts, [6, 7]);
}

// ── 4. Twee "gelijktijdige" klikken op dezelfde stub: allebei lezen max 5,
//       allebei proberen 6 — de tweede moet op 7 landen, nooit ook op 6. ──────
{
	const shared = { taken: new Set([0, 1, 2, 3, 4, 5]), maxSeenByRead: 5 };
	const a = makeDb(shared);
	const b = makeDb(shared);
	const [ra, rb] = await Promise.all([
		createTab(a.db as never, 'ch', null),
		createTab(b.db as never, 'ch', null)
	]);
	const positions = [ra, rb].map((r) => (r.ok ? r.position : -1)).sort();
	assert('twee klikken → posities 6 en 7, geen dubbele', positions, [6, 7]);
}

// ── 5. Alles bezet tot de pogingenlimiet → eerlijke fout, geen eindeloze loop ─
{
	const taken = new Set<number>();
	for (let p = 0; p < 5 + TAB_INSERT_MAX_ATTEMPTS + 2; p++) taken.add(p);
	const { db, inserts } = makeDb({ taken, maxSeenByRead: 5 });
	const r = await createTab(db as never, 'ch', null);
	assert('limiet → ok:false', r.ok, false);
	assert('limiet → precies MAX_ATTEMPTS inserts', inserts.length, TAB_INSERT_MAX_ATTEMPTS);
}

// ── 6. Een ANDERE fout dan 23505 wordt niet weggeretried ─────────────────────
{
	const db = {
		from: () => ({
			select: () => ({
				eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) })
			}),
			insert: () => ({
				select: () => ({
					single: async () => ({
						data: null,
						error: { code: '42501', message: 'permission denied' }
					})
				})
			})
		})
	};
	const r = await createTab(db as never, 'ch', null);
	assert('andere fout → direct ok:false met bericht', r, {
		ok: false,
		error: 'permission denied'
	});
}

// ── Rapport ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const c of checks) {
	if (!c.pass) failed++;
	console.log(`${c.pass ? '✅' : '❌'} ${c.name} — ${c.detail}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
