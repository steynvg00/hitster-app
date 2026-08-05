// Lucky Dice verification — the roll lands on teams.score INSTANTLY.
//
//   npm run bots:verify-group-a-fixes
//
// NO database, NO app, NO mutation. The fix is about what the server *writes*,
// which the live read-only probe (verify-group-a.ts) cannot see: it would take an
// actual activation to observe. So this drives the REAL activatePowerup() out of
// src/lib/server/powerups.ts against a recording fake Supabase client and asserts
// the writes it issues — teams.score directly (old value + roll) plus an
// activity_log entry, and NO team_effects row any more. A leftover
// "+N next submission" effect row would show up in the recorded writes at once.
//
// The fake is deliberately dumb: it records every operation and answers reads
// from a small mutable world. It is not a Postgres emulator.

import { activatePowerup } from '../../src/lib/server/powerups';

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

// ── Lucky Dice: instant score, no waiting effect ──────────────────────────────
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

async function main() {
	await verifyLuckyDice();

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

void main();
