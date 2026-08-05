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

import { activatePowerup, spendXrayReveal } from '../../src/lib/server/powerups';

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
type Op = {
	table: string;
	kind: 'select' | 'insert' | 'update';
	cols?: string;
	values?: Record<string, unknown> | Record<string, unknown>[];
	filters: Record<string, unknown>;
};

type Responder = (op: Op) => unknown;

class FakeQuery {
	op: Op;
	constructor(
		private respond: Responder,
		private log: Op[],
		table: string,
		kind: Op['kind'],
		values?: Op['values'],
		cols?: string
	) {
		this.op = { table, kind, cols, values, filters: {} };
		if (kind !== 'select') this.log.push(this.op);
	}
	select(cols?: string) {
		this.op.cols = cols;
		if (this.op.kind === 'select') this.log.push(this.op);
		return this;
	}
	eq(col: string, val: unknown) {
		this.op.filters[col] = val;
		return this;
	}
	is(col: string, val: unknown) {
		this.op.filters[col] = val;
		return this;
	}
	order() {
		return this;
	}
	limit() {
		return this;
	}
	async maybeSingle() {
		return { data: this.respond(this.op) ?? null, error: null };
	}
	async single() {
		return { data: this.respond(this.op) ?? null, error: null };
	}
	then<T>(onFulfilled: (v: { data: unknown; error: null }) => T) {
		return Promise.resolve({ data: this.respond(this.op) ?? null, error: null }).then(onFulfilled);
	}
}

function makeFake(respond: Responder) {
	const log: Op[] = [];
	const db = {
		from(table: string) {
			return {
				select: (cols?: string) => new FakeQuery(respond, log, table, 'select').select(cols),
				insert: (values: Op['values']) => new FakeQuery(respond, log, table, 'insert', values),
				update: (values: Op['values']) => new FakeQuery(respond, log, table, 'update', values)
			};
		}
	};
	// The real signature is SupabaseClient<Database>; the fake implements only the
	// slice these two functions touch.
	return { db: db as never, log };
}

const opsOn = (log: Op[], table: string, kind?: Op['kind']) =>
	log.filter((o) => o.table === table && (!kind || o.kind === kind));

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
			if (op.cols?.includes('crown_holder_team_id')) return { crown_holder_team_id: world.crownHolder };
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
		const { world, db, log } = luckyDiceWorld({ score: 40, crownHolder: 'other', holderScore: 999 });
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
			[...new Set(opsOn(log, 'team_effects', 'insert').map(
				(o) => (o.values as { effect_type?: string }).effect_type
			))],
			['free_answer']
		);
		assert(
			'…tagged with its source powerup',
			[...new Set(opsOn(log, 'team_effects', 'insert').map(
				(o) => ((o.values as { payload?: Record<string, unknown> }).payload as { source?: string })?.source
			))],
			['x_ray']
		);
		assert('budget row consumed only at 0', !!world.effect.consumed_at, true);
		const tpu = opsOn(log, 'team_powerups', 'update');
		assert('powerup consumed exactly once', tpu.length, 1);
		assert('…and only on the last spend', (tpu[0].values as { status?: string }).status, 'consumed');

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
