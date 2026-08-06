// Group A fixes verification — Lucky Dice's INSTANT score and X-Ray's BUDGET.
//
//   npm run bots:verify-group-a-fixes
//
// NO database, NO app, NO mutation. Both fixes are about what the server *writes*
// and in what order, which the live read-only probe (verify-group-a.ts) cannot
// see: it would take an actual activation to observe. So this drives the REAL
// functions — activatePowerup() and spendXrayReveal() out of
// src/lib/server/powerups.ts — against a recording fake Supabase client, and
// asserts the writes they issue.
//
// What that buys, concretely:
//   * Lucky Dice: proves teams.score is written directly (old value + roll) with
//     an activity_log entry, and that NO team_effects row is created any more —
//     the whole point of the fix. A "+N next submission" effect row would show up
//     in the recorded writes immediately.
//   * X-Ray: proves a budget of 5 permits exactly 5 reveals, that the powerup is
//     consumed on the 5th and not before, and that a refused cell writes nothing
//     and costs no budget.
//
// The fake is deliberately dumb: it records every operation and answers reads
// from a small mutable world. It is not a Postgres emulator — the CAS filter, for
// instance, is asserted structurally (the update carries
// payload->>reveals_remaining = the value that was read) rather than raced.
//
// It DOES validate column names, and that is not decoration. The first version of
// this fake treated .order() as a no-op returning `this`, so spendXrayReveal's
// `.order('created_at')` sailed through all 34 checks — while against the real
// database team_effects has no created_at (it has activated_at), PostgREST
// rejected the entire query, and every reveal came back "No X-Ray running" with a
// budget of 5 sitting right there in the banner. A fake that accepts any column
// name cannot catch a wrong column name, so the real column lists live below.
//
// That guard originally covered .order() and nothing else, which left the far
// busier query parts blind: filters (.eq is 108 calls in powerups.ts and carries
// the CAS), select lists, and the keys of every insert/update. Measured against
// the pre-hardening fake, all four of these returned data with error:null —
//
//   .eq('team_effects.nonexistent_col')   → {"data":{"id":"x"},"error":null}
//   .select('id, totally_bogus_column')   → {"data":{"id":"x"},"error":null}
//   .update({ bogus_key: 1 })             → {"data":{"id":"x"},"error":null}
//   .insert({ nope_not_a_column: 1 })     → {"data":{"id":"x"},"error":null}
//
// — and .in/.neq/.gte/.delete/.upsert did not exist on the class at all, so the
// real code paths that use them (13 .in calls, the resurrection upsert, the
// ticket delete) could not be driven through this fake without a TypeError.
//
// So the guard now runs on EVERY query part that names a column, the missing
// methods exist, and verifySchemaGuard() below pins both halves: the four
// blind spots now error, and a jsonb path filter still does not.
//
// The line this fake does NOT cross: it validates SCHEMA (does the column
// exist), never SEMANTICS. No RLS, no constraints, no races, no type checking of
// values. Those belong to the real-database harnesses (verify-earning,
// verify-regression, verify-battle-integration) and putting them here would make
// a fake that lies in a more sophisticated way.

import { activatePowerup, spendXrayReveal } from '../../src/lib/server/powerups';
import {
	FakeQuery,
	TABLE_COLUMNS,
	makeFake,
	opsOn,
	type Responder,
	type Settled
} from './fake-supabase';

// ── tiny assert harness ───────────────────────────────────────────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? JSON.stringify(got) : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
	console.log(`  ${pass ? '✓' : '✗'} ${name}  ${checks[checks.length - 1].detail}`);
}

// ── recording fake Supabase client ────────────────────────────────────────────
// The class, TABLE_COLUMNS and makeFake() this file drives now live in
// ./fake-supabase.ts, shared with the fase 1b self/defensive activation
// coverage (verify-activation-self-defensive.ts) so both files validate
// against the SAME hardened guard instead of two copies that can drift.
// TABLE_COLUMNS there carries every table this file's own checks below assume
// (team_effects, team_powerups, teams, challenge_attempts, game_sets,
// powerup_types, submissions, activity_log) — nothing here was dropped in the
// extraction; it also carries the fase 1b additions those checks never touch.

// ── 0. The instrument checks itself ───────────────────────────────────────────
//
// Everything below this file's first section is measured BY the fake, so the fake
// being right is a precondition for any of it meaning anything. These checks are
// that precondition, and they are written against the four blind spots the
// pre-hardening version actually had — each `want` here is a value that version
// demonstrably produced, recorded by running its own makeFake:
//
//   .eq('nonexistent_col')              → {"data":{"id":"x"},"error":null}
//   .select('id, totally_bogus_column') → {"data":{"id":"x"},"error":null}
//   .update({ bogus_key: 1 })           → {"data":{"id":"x"},"error":null}
//   .insert({ nope_not_a_column: 1 })   → {"data":{"id":"x"},"error":null}
//
// data present, error null — indistinguishable from a healthy query, which is why
// a wrong column name could reach production through a green suite. The other
// half matters just as much: a guard that fires on a jsonb path would be worse
// than no guard, because the CAS filter would start failing for a reason that
// isn't real.
async function verifySchemaGuard() {
	console.log('\n── 0. Schema guard: the fake catches what it used to wave through ─');

	const { raw } = makeFake(() => ({ id: 'x' }));
	const settle = (q: FakeQuery) => q.then((v) => v);

	// ── the four blind spots ───────────────────────────────────────────────────
	const eqBad = await settle(raw.from('team_effects').select('id').eq('nonexistent_col', 1));
	assert(
		'.eq on an unknown column errors',
		eqBad.error?.message,
		'column team_effects.nonexistent_col does not exist'
	);
	assert('…and returns no data (the shape that hid the bug)', eqBad.data, null);

	const selBad = await settle(raw.from('team_effects').select('id, totally_bogus_column'));
	assert(
		'.select naming an unknown column errors',
		selBad.error?.message,
		'column team_effects.totally_bogus_column does not exist'
	);

	const updBad = await settle(raw.from('teams').update({ bogus_key: 1 }));
	assert(
		'.update writing an unknown key errors',
		updBad.error?.message,
		'column teams.bogus_key does not exist'
	);

	const insBad = await settle(raw.from('team_effects').insert({ nope_not_a_column: 1 }));
	assert(
		'.insert writing an unknown key errors',
		insBad.error?.message,
		'column team_effects.nope_not_a_column does not exist'
	);

	// The original guard, still biting — this is the exact bug that started it all
	// (team_effects has activated_at, not created_at).
	const ordBad = await settle(raw.from('team_effects').select('id').order('created_at'));
	assert(
		'.order on an unknown column still errors',
		ordBad.error?.message,
		'column team_effects.created_at does not exist'
	);

	// ── methods that did not exist before, now present AND guarded ─────────────
	const inBad = await settle(raw.from('team_powerups').select('id').in('not_a_column', ['a']));
	assert(
		'.in exists and is guarded',
		inBad.error?.message,
		'column team_powerups.not_a_column does not exist'
	);

	const neqBad = await settle(raw.from('teams').select('id').neq('missing_col', 1));
	assert(
		'.neq exists and is guarded',
		neqBad.error?.message,
		'column teams.missing_col does not exist'
	);

	const gteBad = await settle(raw.from('team_effects').select('id').gte('made_up_at', 'now'));
	assert(
		'.gte exists and is guarded',
		gteBad.error?.message,
		'column team_effects.made_up_at does not exist'
	);

	const upsBad = await settle(raw.from('challenge_attempts').upsert({ ghost_column: 1 }));
	assert(
		'.upsert exists and is guarded',
		upsBad.error?.message,
		'column challenge_attempts.ghost_column does not exist'
	);

	const delBad = await settle(raw.from('team_effects').delete().eq('phantom_id', 1));
	assert(
		'.delete exists and is guarded',
		delBad.error?.message,
		'column team_effects.phantom_id does not exist'
	);

	// ── the other half: valid queries must stay valid ──────────────────────────
	// The CAS filter, verbatim as powerups.ts:1872 issues it. A guard that fires
	// here would break the real code for an imaginary reason.
	const cas = await settle(
		raw.from('team_effects').update({ payload: {} }).eq('payload->>reveals_remaining', '3')
	);
	assert('jsonb path filter does NOT false-fail', cas.error, null);
	assert('…and still answers with data', cas.data, { id: 'x' });

	const deepJson = await settle(
		raw.from('team_effects').select('id').eq('payload->tab->>id', 'tab1')
	);
	assert('deeper jsonb path does NOT false-fail', deepJson.error, null);

	const star = await settle(raw.from('powerup_types').select('*'));
	assert('select * does NOT false-fail', star.error, null);

	const realCols = await settle(
		raw
			.from('game_sets')
			.select('status, play_state, hard_gaan_window_minutes, powerup_config')
			.eq('id', 'set1')
	);
	assert('a real multi-column select passes', realCols.error, null);

	const embedded = await settle(raw.from('submissions').select('id, teams(display_name)'));
	assert('embedded select is skipped, not failed', embedded.error, null);

	// The documented boundary: a table with no column list is not validated at
	// all, so adding tables stays deliberate and can never false-positive.
	// `clips` (not `challenges` — fase 1b added that one to TABLE_COLUMNS for the
	// free_answer/free_tab/lifeline activation checks, so it no longer qualifies
	// as an example of an unlisted table).
	const unlisted = await settle(raw.from('clips').select('anything_at_all'));
	assert('an unlisted table is left unchecked', unlisted.error, null);

	// One rejected query carries ONE message: the first offence wins, later parts
	// never run — the same way PostgREST reports it.
	const firstWins = await settle(
		raw.from('teams').select('id').eq('first_bogus', 1).eq('second_bogus', 2)
	);
	assert('first offence wins', firstWins.error?.message, 'column teams.first_bogus does not exist');
}

// ── 1. Lucky Dice: instant score, no waiting effect ───────────────────────────
function luckyDiceWorld(opts: {
	score: number;
	crownHolder: string | null;
	holderScore: number;
	powerupConfig?: Record<string, unknown>;
}) {
	const world = { ...opts };
	const respond: Responder = (op) => {
		if (op.table === 'team_powerups' && op.kind === 'select')
			return {
				id: 'tp1',
				team_id: 'team1',
				set_id: 'set1',
				powerup_type_id: 'lucky_dice',
				status: 'held'
			};
		if (op.table === 'powerup_types')
			return { id: 'lucky_dice', name: 'Lucky Dice', holdable: false, immediate_use: true };
		if (op.table === 'game_sets' && op.kind === 'select') {
			// Two different game_sets reads: the activation gate, and the crown lookup.
			if (op.cols?.includes('crown_holder_team_id'))
				return { crown_holder_team_id: world.crownHolder };
			return {
				status: 'active',
				play_state: 'playing',
				powerup_config: world.powerupConfig ?? {}
			};
		}
		if (op.table === 'teams' && op.kind === 'select')
			return { score: op.filters.id === 'team1' ? world.score : world.holderScore };
		if (op.table === 'teams' && op.kind === 'update') {
			if (op.filters.id === 'team1') world.score = (op.values as { score: number }).score;
			return [{ id: op.filters.id }];
		}
		return null;
	};
	return { world, ...makeFake(respond) };
}

async function verifyLuckyDice() {
	console.log('\n── Lucky Dice: the roll lands on teams.score immediately ─────────');

	// Crown is held by another team far ahead, so maybeTransferCrown is a no-op and
	// the score movement is purely the dice.
	{
		const { world, db, log } = luckyDiceWorld({
			score: 40,
			crownHolder: 'other',
			holderScore: 999
		});
		const res = await activatePowerup(db, 'tp1', { allowFromPending: true, rand: () => 0 });

		assert('activation succeeds', res.success, true);
		assert('rand=0 rolls the minimum', (res.payload as { value?: number })?.value, 1);
		assert('teams.score written directly: 40 → 41', world.score, 41);
		assert('payload reports the new total', (res.payload as { new_score?: number })?.new_score, 41);

		// THE regression this fix is about: no pending effect row anywhere.
		assert('NO team_effects row written', opsOn(log, 'team_effects').length, 0);

		const teamUpdates = opsOn(log, 'teams', 'update');
		assert('exactly one teams UPDATE', teamUpdates.length, 1);
		assert('…and it targets this team', teamUpdates[0].filters.id, 'team1');

		const logged = opsOn(log, 'activity_log', 'insert');
		assert('one activity_log row', logged.length, 1);
		assert(
			'…logged as lucky_dice with the roll',
			{
				event_type: (logged[0].values as { event_type?: string }).event_type,
				payload: (logged[0].values as { payload?: Record<string, unknown> }).payload
			},
			{
				event_type: 'lucky_dice',
				payload: { roll: 1, dice_min: 1, dice_max: 6, old_score: 40, new_score: 41 }
			}
		);

		const tpu = opsOn(log, 'team_powerups', 'update');
		assert('powerup marked consumed', (tpu[0]?.values as { status?: string })?.status, 'consumed');
	}

	// Max roll, and this time the roll takes the crown — proving the direct score
	// path still runs the crown check the submission path runs.
	{
		const { world, db, log } = luckyDiceWorld({ score: 0, crownHolder: null, holderScore: 0 });
		const res = await activatePowerup(db, 'tp1', {
			allowFromPending: true,
			rand: () => 0.999999999
		});
		assert('rand→1 rolls the maximum', (res.payload as { value?: number })?.value, 6);
		assert('score after dice + crown steal bonus', world.score, 7);
		const crownLog = opsOn(log, 'activity_log', 'insert').filter(
			(o) => (o.values as { event_type?: string }).event_type === 'crown_stolen'
		);
		assert('crown transfer logged', crownLog.length, 1);
	}

	// The range is a SETTING, end to end: a set configured to 10–10 must add
	// exactly 10 to the score, whatever `rand` returns — proving the branch reads
	// powerup_config rather than a constant.
	{
		const { world, db } = luckyDiceWorld({
			score: 5,
			crownHolder: 'other',
			holderScore: 999,
			powerupConfig: { types: { lucky_dice: { dice_min: 10, dice_max: 10 } } }
		});
		const res = await activatePowerup(db, 'tp1', { allowFromPending: true, rand: () => 0.5 });
		assert('configured 10–10 range rolls 10', (res.payload as { value?: number })?.value, 10);
		assert('…and the score moves by 10: 5 → 15', world.score, 15);
	}
}

// ── 2. X-Ray: a budget of N, spent one reveal at a time ───────────────────────
function xrayWorld(budget: number) {
	const world = {
		effect: {
			id: 'eff1',
			set_id: 'set1',
			payload: { reveals_remaining: budget, reveals_total: budget } as Record<string, unknown>,
			source_team_powerup_id: 'tp1',
			consumed_at: null as string | null
		}
	};
	const respond: Responder = (op) => {
		if (op.table === 'team_effects' && op.kind === 'select') {
			if (op.filters.effect_type !== 'x_ray') return null;
			return world.effect.consumed_at ? null : world.effect;
		}
		if (op.table === 'challenge_attempts') return { id: 'attempt1' };
		if (op.table === 'team_effects' && op.kind === 'update') {
			const values = op.values as Record<string, unknown>;
			if (values.payload) {
				// Compare-and-swap: only applies when the counter still reads what the
				// caller resolved against.
				const expected = op.filters['payload->>reveals_remaining'];
				if (String(world.effect.payload.reveals_remaining) !== expected) return [];
				world.effect.payload = values.payload as Record<string, unknown>;
				return [{ id: 'eff1' }];
			}
			if (values.consumed_at) {
				world.effect.consumed_at = values.consumed_at as string;
				return [{ id: 'eff1' }];
			}
		}
		return null;
	};
	return { world, ...makeFake(respond) };
}

const okResolver = async () => ({
	value: 'Angerfist',
	tags: ['Angerfist'],
	tabId: 'tab1',
	slotIndex: 0
});
const refusingResolver = async () => ({
	error: 'This tab has no track behind it yet — nothing to reveal'
});

async function verifyXray() {
	console.log('\n── X-Ray: budget of 5, spent one field at a time ─────────────────');

	{
		const { world, db, log } = xrayWorld(5);
		const remainings: number[] = [];
		for (let i = 0; i < 5; i++) {
			const r = await spendXrayReveal(
				db,
				{ teamId: 'team1', challengeId: 'ch1', field: 'artist', tabId: 'tab1', slotIndex: i },
				{ resolveReveal: okResolver as never }
			);
			if (!r.success) {
				assert(`spend ${i + 1} succeeds`, r.error, 'success');
				break;
			}
			remainings.push(r.remaining);
		}
		assert('five spends count down 4→0', remainings, [4, 3, 2, 1, 0]);
		assert('one reveal row written per spend', opsOn(log, 'team_effects', 'insert').length, 5);
		assert(
			'…each stored as a free_answer row',
			[
				...new Set(
					opsOn(log, 'team_effects', 'insert').map(
						(o) => (o.values as { effect_type?: string }).effect_type
					)
				)
			],
			['free_answer']
		);
		assert(
			'…tagged with its source powerup',
			[
				...new Set(
					opsOn(log, 'team_effects', 'insert').map(
						(o) =>
							((o.values as { payload?: Record<string, unknown> }).payload as { source?: string })
								?.source
					)
				)
			],
			['x_ray']
		);
		assert('budget row consumed only at 0', !!world.effect.consumed_at, true);
		const tpu = opsOn(log, 'team_powerups', 'update');
		assert('powerup consumed exactly once', tpu.length, 1);
		assert(
			'…and only on the last spend',
			(tpu[0].values as { status?: string }).status,
			'consumed'
		);

		// The sixth attempt has nothing left to spend.
		const sixth = await spendXrayReveal(
			db,
			{ teamId: 'team1', challengeId: 'ch1', field: 'title', tabId: 'tab1', slotIndex: 0 },
			{ resolveReveal: okResolver as never }
		);
		assert('a sixth reveal is refused', sixth.success === false && sixth.error, 'No X-Ray running');
	}

	// Consumption timing, stated as its own check: after four of five spends the
	// powerup must still be alive.
	{
		const { world, db, log } = xrayWorld(5);
		for (let i = 0; i < 4; i++) {
			await spendXrayReveal(
				db,
				{ teamId: 'team1', challengeId: 'ch1', field: 'artist', tabId: 'tab1', slotIndex: i },
				{ resolveReveal: okResolver as never }
			);
		}
		assert('after 4 of 5: budget row still active', world.effect.consumed_at, null);
		assert('after 4 of 5: powerup NOT consumed', opsOn(log, 'team_powerups', 'update').length, 0);
		assert('after 4 of 5: 1 reveal left', world.effect.payload.reveals_remaining, 1);
	}

	console.log('\n── X-Ray: a refused cell costs nothing ───────────────────────────');
	{
		const { world, db, log } = xrayWorld(5);
		const r = await spendXrayReveal(
			db,
			{ teamId: 'team1', challengeId: 'ch1', field: 'artist', tabId: 'tabX', slotIndex: 0 },
			{ resolveReveal: refusingResolver as never }
		);
		assert(
			'refusal is reported verbatim',
			r.success === false && r.error,
			'This tab has no track behind it yet — nothing to reveal'
		);
		assert('budget untouched', world.effect.payload.reveals_remaining, 5);
		assert('no counter UPDATE issued', opsOn(log, 'team_effects', 'update').length, 0);
		assert('no reveal row written', opsOn(log, 'team_effects', 'insert').length, 0);
		assert('powerup not consumed', opsOn(log, 'team_powerups', 'update').length, 0);
	}

	console.log('\n── X-Ray: the decrement is a compare-and-swap ────────────────────');
	{
		const { db, log } = xrayWorld(3);
		await spendXrayReveal(
			db,
			{ teamId: 'team1', challengeId: 'ch1', field: 'year', tabId: 'tab1', slotIndex: 0 },
			{ resolveReveal: okResolver as never }
		);
		const upd = opsOn(log, 'team_effects', 'update')[0];
		assert(
			'update is guarded on the value that was read',
			upd.filters['payload->>reveals_remaining'],
			'3'
		);
		assert(
			'…and writes exactly one less',
			(upd.values as { payload?: { reveals_remaining?: number } }).payload?.reveals_remaining,
			2
		);
	}

	console.log('\n── X-Ray: the lookup only touches columns that exist ─────────────');
	{
		// The regression guard for the "No X-Ray running with a budget of 5" bug: the
		// budget lookup sorted by a column team_effects does not have, PostgREST
		// refused the query, and a query error was read as "no effect".
		const { db, log } = xrayWorld(2);
		await spendXrayReveal(
			db,
			{ teamId: 'team1', challengeId: 'ch1', field: 'artist', tabId: 'tab1', slotIndex: 0 },
			{ resolveReveal: okResolver as never }
		);
		const lookup = log.find((o) => o.table === 'team_effects' && o.kind === 'select');
		assert('budget lookup sorts by activated_at', lookup?.orderBy, 'activated_at');
		assert(
			'…which is a real team_effects column',
			TABLE_COLUMNS.team_effects.includes(lookup?.orderBy ?? ''),
			true
		);

		// And prove the guard itself bites: a bogus sort column must produce a
		// PostgREST-shaped error, not a silent empty result.
		const probe = makeFake(() => ({ id: 'x' }));
		const bogus = await probe.raw
			.from('team_effects')
			.select('id')
			.order('created_at')
			.limit(1)
			.maybeSingle();
		assert(
			'a bogus sort column errors like PostgREST does',
			bogus.error?.message,
			'column team_effects.created_at does not exist'
		);
		assert('…and returns no data', bogus.data, null);
	}

	console.log('\n── X-Ray: no budget at all ───────────────────────────────────────');
	{
		const { db } = makeFake(() => null);
		const r = await spendXrayReveal(
			db,
			{ teamId: 'team1', challengeId: 'ch1', field: 'artist', tabId: 'tab1', slotIndex: 0 },
			{ resolveReveal: okResolver as never }
		);
		assert('refused without an active X-Ray', r.success === false && r.error, 'No X-Ray running');
	}
}

async function main() {
	await verifySchemaGuard();
	await verifyLuckyDice();
	await verifyXray();

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

void main();
