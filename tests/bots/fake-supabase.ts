// Shared recording fake Supabase client for bots:verify-* activation tests.
//
// Extracted from tests/bots/verify-group-a-fixes.ts (commit b0e505b, "harden
// fake-client to validate schema across all query parts") so the SAME hardened
// guard backs every activation test file instead of each one growing its own
// copy that can drift out of sync. Behaviour is unchanged from that commit —
// this is a pure extraction, not a rewrite. verify-group-a-fixes.ts's own
// verifySchemaGuard() still pins the guard's behaviour against this module.
//
// The fake is deliberately dumb: it records every operation and answers reads
// from a small mutable world a test supplies via its own `respond` closure. It
// is not a Postgres emulator — a CAS filter is asserted structurally (the
// update carries payload->>col = the value that was read) rather than raced.
//
// It DOES validate column names, and that is not decoration — see the header
// of verify-group-a-fixes.ts for the bug history this guards against. A column
// reference is checked on every query part that names one: filters, select
// lists, and the keys of every insert/update/upsert.
//
// The line this fake does NOT cross: it validates SCHEMA (does the column
// exist), never SEMANTICS. No RLS, no constraints, no races, no type checking
// of values. Those belong to the real-database harnesses (verify-earning,
// verify-regression, verify-battle-integration).

export type Op = {
	table: string;
	kind: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
	cols?: string;
	values?: Record<string, unknown> | Record<string, unknown>[];
	filters: Record<string, unknown>;
	orderBy?: string;
};

export type Responder = (op: Op) => unknown;
export type Settled = { data: unknown; error: { message: string } | null };

// Real column lists, read from the live database's own PostgREST schema
// (GET /rest/v1/ → definitions.<table>.properties) rather than transcribed from
// the migrations. The spec is what PostgREST itself will accept, which is the
// exact thing this fake imitates; a migration transcript is one copy further
// from that and drifts silently.
//
// A table absent from this map is NOT validated. That keeps the guard opt-in
// per table: an unlisted table can never produce a false positive, and adding
// one is a deliberate act (read its real column list first — do not hand-write
// it).
export const TABLE_COLUMNS: Record<string, string[]> = {
	team_effects: [
		'id',
		'team_id',
		'set_id',
		'effect_type',
		'payload',
		'activated_at',
		'expires_at',
		'consumed_at',
		'consumed_challenge_id',
		'source_team_powerup_id'
	],
	team_powerups: [
		'id',
		'team_id',
		'set_id',
		'powerup_type_id',
		'granted_at',
		'granted_from_challenge_id',
		'used_at',
		'status',
		'payload'
	],
	teams: [
		'id',
		'color',
		'label',
		'score',
		'created_at',
		'display_name',
		'current_streak',
		'photo_url',
		'token_balance',
		'held_powerups',
		'last_threshold_crossed'
	],
	challenge_attempts: [
		'id',
		'challenge_id',
		'team_id',
		'started_at',
		'ended_at',
		'created_at',
		'timer_override_seconds'
	],
	game_sets: [
		'id',
		'name',
		'description',
		'team_count',
		'total_timer_seconds',
		'status',
		'started_at',
		'ended_at',
		'created_at',
		'expected_player_count',
		'assignment_slots',
		'assignment_index',
		'recap_state',
		'recap_ranking',
		'recap_reveal_index',
		'created_by',
		'play_state',
		'scores_hidden',
		'nfc_lock_enabled',
		'last_results',
		'powerups_enabled',
		'powerup_config',
		'powerup_mode',
		'preset_slug',
		'token_earning_config',
		'challenge_unlock_mode',
		'team_selection_mode',
		'crown_holder_team_id',
		'hard_gaan_window_minutes',
		'crown_payout_applied',
		'battle_reveal_index'
	],
	powerup_types: [
		'id',
		'name',
		'category',
		'description',
		'immediate_use',
		'holdable',
		'default_min_score_pct',
		'default_max_score_pct',
		'sort_order',
		'icon',
		'enabled_by_default',
		'created_at',
		'coming_soon',
		'default_inverse',
		'tier'
	],
	submissions: [
		'id',
		'challenge_id',
		'team_id',
		'answers',
		'score',
		'submitted_at',
		'created_at',
		'status',
		'is_final',
		'battle_raw_score'
	],
	activity_log: ['id', 'event_type', 'team_id', 'challenge_id', 'payload', 'created_at'],
	// Added for fase 1b (self/defensive activation coverage): every table the
	// double_down / free_answer / free_tab / lifeline / resurrection / time_boost
	// branches read, beyond what fase 1a's Group A fixes already touched. Fetched
	// read-only from the live PostgREST OpenAPI spec on 2026-08-06
	// (GET /rest/v1/ with the service-role key — the anon key 403s on that
	// endpoint; schema introspection only, no table data and no mutation).
	challenges: [
		'id',
		'variant',
		'title',
		'timer_seconds',
		'is_active',
		'created_at',
		'stage_label',
		'status',
		'points_config',
		'created_by',
		'difficulty_rating',
		'speed_threshold_seconds',
		'hint_text',
		'nfc_lock_override',
		'unlock_mode',
		'year_min',
		'year_max'
	],
	challenge_tabs: ['id', 'challenge_id', 'position', 'created_at', 'created_by', 'effects', 'mashup_id', 'fields'],
	variant_defaults: ['variant', 'points_config', 'streak_config', 'tutorial_text'],
	challenge_tab_source_tracks: ['id', 'tab_id', 'track_id', 'sort_order'],
	challenge_tab_clips: ['id', 'tab_id', 'clip_id', 'fragment_number', 'sort_order'],
	tracks: [
		'id',
		'artist',
		'title',
		'year',
		'record_label',
		'festival',
		'vocal_source',
		'created_at',
		'genre',
		'subgenre',
		'accepted_titles',
		'created_by',
		'artists'
	],
	set_challenges: [
		'id',
		'set_id',
		'challenge_id',
		'position',
		'created_by',
		'challenge_multiplier',
		'battle_resolved_at',
		'battle_ranking'
	]
};

// A column reference in a query is not always a bare column name:
//
//   'payload'                     → a column
//   'payload->>reveals_remaining' → column `payload`, then a key INSIDE the jsonb
//                                   document. This is the X-Ray CAS filter
//                                   (powerups.ts:1872) and it is perfectly valid —
//                                   failing it would be the guard lying.
//   'payload->tab->>id'           → same, deeper path
//   '*'                           → every column
//
// Only the part before the first `->` names a column of this table. Everything
// after it is jsonb content, which no schema describes and Postgres never
// rejects, so it is deliberately not looked at. That single split is the whole
// distinction between a real column mismatch and a json path.
export function columnPart(ref: string): string {
	return ref.split('->')[0].trim();
}

// Split a PostgREST select list on top-level commas only, so an embedded select
// (`tracks(id, title)`) stays one item instead of shattering into columns that
// belong to another table.
export function splitSelectList(cols: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of cols) {
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		if (ch === ',' && depth === 0) {
			out.push(cur);
			cur = '';
			continue;
		}
		cur += ch;
	}
	out.push(cur);
	return out.map((s) => s.trim()).filter(Boolean);
}

export class FakeQuery {
	op: Op;
	error: string | null = null;
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
		this.checkValues(values);
	}

	/**
	 * The one place a column name is judged. Latches a PostgREST-shaped error on
	 * the FIRST offence (a rejected query has one message, and the later parts
	 * never run), and stays silent for tables this fake has no list for.
	 *
	 * It never throws: PostgREST reports a bad column as a RESULT, and the bug
	 * class this exists to catch is precisely a query error being read as "no
	 * rows". Throwing would make it loud in a way the real failure never is.
	 */
	private checkColumn(ref: string) {
		if (this.error) return;
		const known = TABLE_COLUMNS[this.op.table];
		if (!known) return;
		const col = columnPart(ref);
		if (!col || col === '*') return;
		if (!known.includes(col)) {
			this.error = `column ${this.op.table}.${col} does not exist`;
		}
	}

	/**
	 * Validate a select list. Two things are skipped on purpose, and both fail
	 * SAFE (unchecked, never falsely rejected):
	 *   - embedded selects `foreign_table(cols)` — they name columns on another
	 *     table and this fake holds no relationship map to resolve them.
	 *   - items containing ':' (aliases `alias:col`, casts `col::text`) — no
	 *     caller in this codebase emits them today.
	 * If either ever matters, the guard degrades to "not checked" rather than to
	 * a false failure, which is the direction a measuring instrument must fail in.
	 */
	private checkSelect(cols?: string) {
		if (!cols) return;
		for (const item of splitSelectList(cols)) {
			if (item.includes('(') || item.includes(':')) continue;
			this.checkColumn(item);
		}
	}

	/** Every key of an inserted/updated/upserted row is a column name. */
	private checkValues(values?: Op['values']) {
		if (!values) return;
		for (const row of Array.isArray(values) ? values : [values]) {
			if (!row || typeof row !== 'object') continue;
			for (const key of Object.keys(row)) this.checkColumn(key);
		}
	}

	/** Shared body of every filter method — the column is checked, then recorded. */
	private addFilter(col: string, val: unknown) {
		this.checkColumn(col);
		this.op.filters[col] = val;
		return this;
	}

	select(cols?: string) {
		this.op.cols = cols;
		this.checkSelect(cols);
		if (this.op.kind === 'select') this.log.push(this.op);
		return this;
	}
	eq(col: string, val: unknown) {
		return this.addFilter(col, val);
	}
	neq(col: string, val: unknown) {
		return this.addFilter(col, val);
	}
	is(col: string, val: unknown) {
		return this.addFilter(col, val);
	}
	in(col: string, vals: unknown[]) {
		return this.addFilter(col, vals);
	}
	gt(col: string, val: unknown) {
		return this.addFilter(col, val);
	}
	gte(col: string, val: unknown) {
		return this.addFilter(col, val);
	}
	lt(col: string, val: unknown) {
		return this.addFilter(col, val);
	}
	lte(col: string, val: unknown) {
		return this.addFilter(col, val);
	}
	/** PostgREST's escape hatch: .filter(col, operator, value). */
	filter(col: string, _operator: string, val: unknown) {
		return this.addFilter(col, val);
	}
	order(col?: string, _opts?: unknown) {
		if (col) this.checkColumn(col);
		this.op.orderBy = col;
		return this;
	}
	limit(_n?: number) {
		return this;
	}
	private settle(): Settled {
		// PostgREST returns the error and NO data — the shape that made the original
		// bug look like "there is no effect".
		if (this.error) return { data: null, error: { message: this.error } };
		return { data: this.respond(this.op) ?? null, error: null };
	}
	async maybeSingle(): Promise<Settled> {
		return this.settle();
	}
	async single(): Promise<Settled> {
		return this.settle();
	}
	then<T>(onFulfilled: (v: Settled) => T) {
		return Promise.resolve(this.settle()).then(onFulfilled);
	}
}

export type FakeTable = {
	select: (cols?: string) => FakeQuery;
	insert: (values: Op['values']) => FakeQuery;
	update: (values: Op['values']) => FakeQuery;
	upsert: (values: Op['values'], options?: unknown) => FakeQuery;
	delete: () => FakeQuery;
};

export function makeFake(respond: Responder) {
	const log: Op[] = [];
	const db = {
		from(table: string): FakeTable {
			return {
				select: (cols?: string) => new FakeQuery(respond, log, table, 'select').select(cols),
				insert: (values: Op['values']) => new FakeQuery(respond, log, table, 'insert', values),
				update: (values: Op['values']) => new FakeQuery(respond, log, table, 'update', values),
				upsert: (values: Op['values']) => new FakeQuery(respond, log, table, 'upsert', values),
				delete: () => new FakeQuery(respond, log, table, 'delete')
			};
		}
	};
	// The real signature is SupabaseClient<Database>; the fake implements only the
	// slice the powerup code touches. `raw` is the same object under a type the
	// self-tests can call directly, so probing the guard needs no casts.
	return { db: db as never, raw: db, log };
}

export const opsOn = (log: Op[], table: string, kind?: Op['kind']) =>
	log.filter((o) => o.table === table && (!kind || o.kind === kind));

// ── tiny assert harness, shared so every activation test file prints/counts
// checks the same way ──────────────────────────────────────────────────────
export type Check = { name: string; pass: boolean; detail: string };

export function makeAsserter() {
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
	return { checks, assert };
}
