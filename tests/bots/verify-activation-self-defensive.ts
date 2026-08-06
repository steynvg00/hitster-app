// Fase 1b — activation coverage for the SELF/DEFENSIVE powerup types.
//
//   npm run bots:verify-activation-self-defensive
//
// NO database, NO app, NO mutation. Same instrument as verify-group-a-fixes.ts
// (which this file shares ./fake-supabase.ts with): the REAL activatePowerup()
// (and, for all_seeing_eye's strip, the real stripAnswersForEye()) is driven
// against a recording fake Supabase client, and the writes it issues are
// asserted against an INDEPENDENTLY reasoned expected shape — read by hand from
// src/lib/server/powerups.ts and cross-checked against the migrations that seed
// the catalog (0044, 0057, 0071 …), never imported from the activation code
// itself. Importing the code's own constants as "expected" would make the
// harness test itself.
//
// ── WHAT A GREEN RUN PROVES, AND WHAT IT DOES NOT ─────────────────────────────
// This proves activation is SCHEMA-CORRECT (every column it touches exists) and
// writes the RIGHT ROWS (right table, right effect_type, right payload shape,
// right status transition) against the fake. It does NOT prove the effect
// WORKS end-to-end in the browser or on the party floor — that is the
// browser/Cowork layer, untouched here. A green run means "activation will not
// blow up on a schema mismatch and writes what the code intends to write", not
// "hard_gaan actually multiplies the next submission's score".
//
// ── SCOPE ──────────────────────────────────────────────────────────────────
// Covers the 12 self/defensive types that need no target team:
//   bonus_points, hard_gaan, single_event_mult, shield, time_boost, insurance,
//   double_down, free_tab, lifeline, power_spin, resurrection, free_answer
// (lucky_dice and x_ray's ACTIVATION branch are already covered in
// verify-group-a-fixes.ts — not repeated here.)
//
// Borderline — all_seeing_eye (powerups.ts:2627-2687): the refuse condition
// (no finished team → stays held, powerups.ts:2648-2653), the HAPPY-PATH WRITE
// (consumed snapshot row + status transition + stripped payload, both
// show_scores stands — added for R1 gap 2, mutation-caught) and the strip
// (stripAnswersForEye, powerups.ts:255-294) are tested. The cross-team
// READ/DISPLAY itself (resolveAllSeeingEye's join across submissions+teams) is
// deliberately NOT re-tested against a live DB here — that concern is covered
// by tests/bots/verify-all-seeing-eye.ts.
//
// give_a_shot classification (powerups.ts:2944-2993): OFFENSIVE, not covered
// here. Line 2947-2950 requires `options.targetTeamId`, rejects a missing
// target and rejects `targetTeamId === tpu.team_id` ("Cannot target your own
// team") — it can only ever act on ANOTHER team's team_effects row
// (powerups.ts:2977, `team_id: targetTeamId`). Same shape as freeze/time_drain/
// tap_to_break. → phase 2.
// Explicitly out of scope for the same reason: freeze, time_drain,
// tap_to_break (powerups.ts:2995-3144, all require targetTeamId and write to
// the TARGET's team_effects row).
//
// ── EARNING GAP (fase 1b step 2) ──────────────────────────────────────────
// lifeline and penalty_shot are default_inverse=true (0071_enable_lifeline.sql
// line 85, 0057_penalty_shot_live.sql line 45) — earned on a LOW score via
// planAwards' inverse channel, not the normal ladder. That gap is closed in
// tests/bots/verify-earning-inverse.ts, its own file: planAwards is pure
// (no DB, no fake), so it needs none of this file's machinery.

import { activatePowerup, stripAnswersForEye } from '../../src/lib/server/powerups';
import { computeBreakdown } from '../../src/lib/server/scoring';
import { doubleDownMultiplier, maskAnswer } from '../../src/lib/powerups-meta';
import { makeFake, makeAsserter, opsOn, type Op, type Responder } from './fake-supabase';

const { checks, assert } = makeAsserter();

// ── shared fixture pieces ─────────────────────────────────────────────────────

/** team_powerups + powerup_types + game_sets — the three tables activatePowerup
 * reads before it ever reaches the type switch (powerups.ts:1934-1963). Every
 * scenario below needs these; only the parts a scenario cares about differ. */
function baseRespond(opts: {
	typeId: string;
	tpuStatus?: string;
	typeExtra?: Record<string, unknown>;
	gameSetExtra?: Record<string, unknown>;
	powerupConfig?: Record<string, unknown>;
}): Responder {
	return (op: Op) => {
		if (op.table === 'team_powerups' && op.kind === 'select') {
			return {
				id: 'tp1',
				team_id: 'team1',
				set_id: 'set1',
				powerup_type_id: opts.typeId,
				status: opts.tpuStatus ?? 'held'
			};
		}
		if (op.table === 'powerup_types' && op.kind === 'select') {
			// activatePowerup's OWN type lookup filters .eq('id', ...) — a bare
			// `.select('*')` with no filter is a DIFFERENT query (power_spin's pool
			// fetch, `select('*')` over every type), which a scenario that needs it
			// answers itself; left unhandled here rather than returning the wrong
			// shape (a single object where an array is expected).
			if (Object.keys(op.filters).length === 0) return undefined;
			return { id: opts.typeId, name: opts.typeId, ...opts.typeExtra };
		}
		if (op.table === 'game_sets' && op.kind === 'select') {
			return {
				status: 'active',
				play_state: 'playing',
				powerup_config: opts.powerupConfig ?? {},
				...opts.gameSetExtra
			};
		}
		// Default id for a fresh team_effects row. Every branch that reads it back
		// (.select('id').single()) only uses it to fill ActivateResult.effectId —
		// none of the checks below assert a specific id, so one constant is enough.
		// SELECTs on team_effects are deliberately NOT defaulted here: those are
		// the per-type guards (existing shield / bet / x_ray / ticket), and each
		// scenario supplies its own answer for them.
		if (op.table === 'team_effects' && op.kind === 'insert') return { id: 'eff1' };
		return undefined;
	};
}

/** Compose several Responders, first non-undefined answer wins. */
function chain(...responders: Responder[]): Responder {
	return (op) => {
		for (const r of responders) {
			const v = r(op);
			if (v !== undefined) return v;
		}
		return null;
	};
}

/**
 * A single-tab, 'standard'-variant challenge (fields: artist/title/year) behind
 * one source track — the minimal fixture resolveFreeAnswerValue and
 * resolveLifelineHints need to resolve an answer. Track: Angerfist —
 * "Incoming Chaos" (2015), no record_label/festival, no artists[] override
 * (falls back to the scalar `artist`, same as artistTargets does for any track
 * that predates the multi-artist column).
 */
function challengeWorld(opts: {
	timerSeconds?: number | null;
	hasOpenAttempt?: boolean;
	elapsedFraction?: number;
	boostSeconds?: number;
}): Responder {
	const timerSeconds = opts.timerSeconds === undefined ? 120 : opts.timerSeconds;
	const elapsedFraction = opts.elapsedFraction ?? 0;
	const startedAt = opts.hasOpenAttempt
		? new Date(Date.now() - elapsedFraction * (timerSeconds ?? 0) * 1000).toISOString()
		: null;
	return (op: Op) => {
		if (op.table === 'challenges' && op.kind === 'select') {
			return { variant: 'standard', points_config: {}, timer_seconds: timerSeconds };
		}
		if (op.table === 'challenge_tabs' && op.kind === 'select') {
			return [{ id: 'tab1', challenge_id: 'ch1', position: 0, mashup_id: null, fields: null }];
		}
		if (op.table === 'variant_defaults' && op.kind === 'select') {
			return { variant: 'standard', points_config: { field_points: {} } };
		}
		if (op.table === 'challenge_tab_source_tracks' && op.kind === 'select') {
			return [{ id: 'src1', tab_id: 'tab1', track_id: 'trk1', sort_order: 0 }];
		}
		if (op.table === 'challenge_tab_clips' && op.kind === 'select') {
			return [];
		}
		if (op.table === 'tracks' && op.kind === 'select') {
			return [
				{
					id: 'trk1',
					artist: 'Angerfist',
					title: 'Incoming Chaos',
					year: 2015,
					record_label: null,
					festival: null,
					artists: null
				}
			];
		}
		if (op.table === 'challenge_attempts' && op.kind === 'select') {
			// double_down's set-wide guard uses .in('challenge_id', [...]) — array
			// filter value. Every other caller here uses .eq() — scalar value.
			if (Array.isArray(op.filters['challenge_id'])) return [];
			return opts.hasOpenAttempt ? { id: 'attempt1', started_at: startedAt } : null;
		}
		if (op.table === 'team_effects' && op.kind === 'select') {
			// attemptElapsedFraction's boost lookup: .in('effect_type', [...]).
			if (Array.isArray(op.filters['effect_type'])) {
				return opts.boostSeconds
					? [{ payload: { added_seconds: opts.boostSeconds, challenge_id: 'ch1' } }]
					: [];
			}
			return undefined; // guard-specific checks (shield/double_down/x_ray/resurrection) override this
		}
		return undefined;
	};
}

// ── 1. bonus_points — immediate flat effect ───────────────────────────────────
// powerups.ts:1969-1988: insert team_effects{effect_type:'bonus_points',
// payload:{value:5}}, team_powerups → 'active'. Value 5 is read directly off
// the line (not imported) — this is exactly what deriveEffectModifiers reads
// back at powerups.ts:906 (`?? 5`), a second independent confirmation of the
// literal, and it matches the card ("+5 points to your team immediately.").
async function verifyBonusPoints() {
	console.log('\n── bonus_points: flat +5, held → active ──────────────────────────');
	const respond = baseRespond({ typeId: 'bonus_points' });
	const { db, log } = makeFake(respond);
	const res = await activatePowerup(db, 'tp1');

	assert('activation succeeds', res.success, true);
	assert('payload is the flat value', res.payload, { value: 5 });
	const ins = opsOn(log, 'team_effects', 'insert');
	assert('one team_effects insert', ins.length, 1);
	assert('…effect_type bonus_points, source tagged', {
		effect_type: (ins[0].values as Record<string, unknown>).effect_type,
		payload: (ins[0].values as Record<string, unknown>).payload,
		source_team_powerup_id: (ins[0].values as Record<string, unknown>).source_team_powerup_id
	}, { effect_type: 'bonus_points', payload: { value: 5 }, source_team_powerup_id: 'tp1' });
	const tpu = opsOn(log, 'team_powerups', 'update');
	assert('team_powerups → active', (tpu[0]?.values as { status?: string })?.status, 'active');
}

// ── 2. single_event_mult — one-shot ×1.5 ──────────────────────────────────────
// powerups.ts:2152-2171: insert team_effects{effect_type:'single_event_mult',
// payload:{multiplier:1.5}}, team_powerups → 'active'.
async function verifySingleEventMult() {
	console.log('\n── single_event_mult: ×1.5, held → active ────────────────────────');
	const respond = baseRespond({ typeId: 'single_event_mult' });
	const { db, log } = makeFake(respond);
	const res = await activatePowerup(db, 'tp1');

	assert('activation succeeds', res.success, true);
	assert('payload carries the multiplier', res.payload, { multiplier: 1.5 });
	const ins = opsOn(log, 'team_effects', 'insert');
	assert('…effect_type single_event_mult', (ins[0].values as Record<string, unknown>).effect_type, 'single_event_mult');
	assert('no expires_at (unlike hard_gaan)', (ins[0].values as Record<string, unknown>).expires_at, undefined);
	const tpu = opsOn(log, 'team_powerups', 'update');
	assert('team_powerups → active', (tpu[0]?.values as { status?: string })?.status, 'active');
}

// ── 3. hard_gaan — window multiplier with expires_at ──────────────────────────
// powerups.ts:2173-2197: expiresAt = now + hard_gaan_window_minutes (default 15
// when the set has none set) minutes; payload{multiplier:1.5, window_minutes}.
async function verifyHardGaan() {
	console.log('\n── hard_gaan: ×1.5 window, expires_at from the set (or default 15) ─');

	{
		const before = Date.now();
		const respond = baseRespond({
			typeId: 'hard_gaan',
			gameSetExtra: { hard_gaan_window_minutes: null }
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1');
		const after = Date.now();

		assert('activation succeeds', res.success, true);
		assert('payload: default 15-minute window', res.payload, { multiplier: 1.5, window_minutes: 15 });
		const ins = opsOn(log, 'team_effects', 'insert')[0];
		const expiresAt = new Date((ins.values as { expires_at: string }).expires_at).getTime();
		assert(
			'expires_at ≈ now + 15min (within the call window)',
			expiresAt >= before + 15 * 60 * 1000 && expiresAt <= after + 15 * 60 * 1000,
			true
		);
	}

	{
		// A set with a configured window overrides the default.
		const respond = baseRespond({
			typeId: 'hard_gaan',
			gameSetExtra: { hard_gaan_window_minutes: 20 }
		});
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1');
		assert('configured 20-minute window used', res.payload, { multiplier: 1.5, window_minutes: 20 });
	}
}

// ── 4. shield — one at a time ──────────────────────────────────────────────────
// powerups.ts:2199-2230: guard reads an existing non-consumed shield row first;
// if found, refuse and leave the powerup HELD (no team_powerups update at all).
async function verifyShield() {
	console.log('\n── shield: activates once, a second activation is refused ────────');

	{
		const respond = chain(baseRespond({ typeId: 'shield' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return null; // no existing shield
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1');

		assert('first activation succeeds', res.success, true);
		const ins = opsOn(log, 'team_effects', 'insert');
		assert('…effect_type shield, empty payload', {
			effect_type: (ins[0].values as Record<string, unknown>).effect_type,
			payload: (ins[0].values as Record<string, unknown>).payload
		}, { effect_type: 'shield', payload: {} });
		assert('team_powerups → active', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'active');
	}

	{
		const respond = chain(baseRespond({ typeId: 'shield' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return { id: 'existing-shield' };
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1');

		assert('second activation refused', res.success === false && res.error, 'Shield already up');
		assert('nothing inserted', opsOn(log, 'team_effects', 'insert').length, 0);
		assert('powerup stays held (no status update)', opsOn(log, 'team_powerups', 'update').length, 0);
	}
}

// ── 5. double_down — the three activation guards, and the settlement no-op ───
// powerups.ts:2232-2318 (activation); scoring.ts:1232-1252 (settlement).
async function verifyDoubleDown() {
	console.log('\n── double_down: prediction range, before-challenge-only, one bet ──');

	// Guard 1 (powerups.ts:2238-2246): non-integer / out-of-range / missing.
	{
		const respond = chain(baseRespond({ typeId: 'double_down' }), () => undefined);
		const { db } = makeFake(respond);
		const missing = await activatePowerup(db, 'tp1');
		assert('missing prediction refused', missing.success === false && missing.error, 'Double Down needs a prediction between 0 and 100');
		const outOfRange = await activatePowerup(db, 'tp1', { predictedPct: 150 });
		assert('out-of-range prediction refused', outOfRange.success === false && outOfRange.error, 'Double Down needs a prediction between 0 and 100');
		const nonInteger = await activatePowerup(db, 'tp1', { predictedPct: 42.5 });
		assert('non-integer prediction refused', nonInteger.success === false && nonInteger.error, 'Double Down needs a prediction between 0 and 100');
	}

	// Guard 2 (powerups.ts:2262-2281): an open attempt on one of the set's
	// challenges blocks activation. set_challenges non-empty + an open attempt
	// on the .in() lookup.
	{
		const respond = chain(baseRespond({ typeId: 'double_down' }), (op) => {
			if (op.table === 'set_challenges' && op.kind === 'select') return [{ challenge_id: 'ch1' }];
			if (op.table === 'challenge_attempts' && op.kind === 'select' && Array.isArray(op.filters['challenge_id'])) {
				return { id: 'attempt1' };
			}
			return undefined;
		});
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { predictedPct: 50 });
		assert('open attempt in the set refuses activation', res.success === false && res.error, 'Double Down must be activated before a challenge starts');
	}

	// Guard 3 (powerups.ts:2287-2296): a live bet already running.
	{
		const respond = chain(baseRespond({ typeId: 'double_down' }), (op) => {
			if (op.table === 'set_challenges' && op.kind === 'select') return [];
			if (op.table === 'team_effects' && op.kind === 'select') return { id: 'existing-bet' };
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { predictedPct: 50 });
		assert('an already-running bet refuses a second one', res.success === false && res.error, 'A Double Down is already running');
		assert('powerup stays held', opsOn(log, 'team_powerups', 'update').length, 0);
	}

	// Happy path: no set challenges (guard 2 skipped), no existing bet.
	{
		const respond = chain(baseRespond({ typeId: 'double_down' }), (op) => {
			if (op.table === 'set_challenges' && op.kind === 'select') return [];
			if (op.table === 'team_effects' && op.kind === 'select') return null;
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { predictedPct: 70 });

		assert('activation succeeds', res.success, true);
		assert('payload carries the prediction', res.payload, { predicted_pct: 70 });
		const ins = opsOn(log, 'team_effects', 'insert')[0];
		assert('…effect_type double_down', (ins.values as Record<string, unknown>).effect_type, 'double_down');
		assert('no expires_at — rides until the next submission', (ins.values as Record<string, unknown>).expires_at, undefined);
		assert('team_powerups → active', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'active');
	}

	// The settlement side, NOT activatePowerup: computeBreakdown's own no-op
	// guard for a challenge with no measurable percentage (scoring.ts:1232-1252,
	// "thresholdMax = 0 ... the bet resolves to a no-op ×1.0"). Included here
	// because the task names it explicitly; it is a different function
	// (computeBreakdown, scoring.ts) than the activation branch above.
	{
		const breakdown = computeBreakdown(
			10,
			{
				difficulty_rating: 3,
				challenge_multiplier: 1,
				team_score: 0,
				leader_score: 0,
				current_streak: 0,
				streak_thresholds: [],
				elapsed_seconds: null,
				speed_threshold_seconds: null,
				doubleDownPct: 70
			},
			{ total: 0, max: 0 }
		);
		assert('thresholdMax=0 → double_down resolves to a no-op ×1', breakdown.double_down?.multiplier, 1);
		assert('…hit is false, score_pct 0 (nothing measurable)', {
			hit: breakdown.double_down?.hit,
			score_pct: breakdown.double_down?.score_pct
		}, { hit: false, score_pct: 0 });
		assert('…and the final score is unaffected by the bet', breakdown.final, 10);

		// Independent oracle for a MEASURABLE case, cross-checking doubleDownMultiplier
		// directly (powerups-meta.ts:62-72) rather than trusting computeBreakdown's
		// internal call to it: hit at exactly the predicted percentage.
		const hitMultiplier = doubleDownMultiplier(70, 70);
		assert('doubleDownMultiplier: hit at exactly the prediction → 1 + g/100', hitMultiplier, 1.7);
		const missMultiplier = doubleDownMultiplier(70, 10);
		assert('…a miss → 1 - g/100', missMultiplier, 0.3);
	}
}

// ── 6. time_boost — consumed marker, +30s ─────────────────────────────────────
// powerups.ts:2320-2361: needs an open attempt AND a timed challenge; writes an
// ALREADY-CONSUMED team_effects row, team_powerups → 'consumed' immediately.
async function verifyTimeBoost() {
	console.log('\n── time_boost: +30s, needs an open attempt + timed challenge ──────');

	{
		const respond = chain(baseRespond({ typeId: 'time_boost' }), challengeWorld({ hasOpenAttempt: false }));
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('no open attempt refuses activation', res.success === false && res.error, 'No active attempt for this challenge');
	}

	{
		const respond = chain(baseRespond({ typeId: 'time_boost' }), challengeWorld({ hasOpenAttempt: true, timerSeconds: null }));
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('untimed challenge refuses activation', res.success === false && res.error, 'Time boost requires a timed challenge');
	}

	{
		const respond = chain(baseRespond({ typeId: 'time_boost' }), challengeWorld({ hasOpenAttempt: true, timerSeconds: 120 }));
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });

		assert('activation succeeds', res.success, true);
		const ins = opsOn(log, 'team_effects', 'insert')[0];
		const v = ins.values as Record<string, unknown>;
		assert('…effect_type time_boost, +30s, addressed to this challenge', {
			effect_type: v.effect_type,
			payload: v.payload
		}, { effect_type: 'time_boost', payload: { added_seconds: 30, challenge_id: 'ch1' } });
		assert('written ALREADY consumed', v.consumed_at != null, true);
		assert('team_powerups → consumed (not active)', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'consumed');
	}
}

// ── 7. insurance — 50% floor, held until consumed at scoring ─────────────────
// powerups.ts:2363-2395: needs an open attempt; writes a NON-consumed team_effects
// row (unlike time_boost), team_powerups → 'active' (spent later, at scoring).
async function verifyInsurance() {
	console.log('\n── insurance: 50% floor, active until the submission consumes it ──');

	{
		const respond = chain(baseRespond({ typeId: 'insurance' }), challengeWorld({ hasOpenAttempt: false }));
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('no open attempt refuses activation', res.success === false && res.error, 'No active attempt for this challenge');
	}

	{
		const respond = chain(baseRespond({ typeId: 'insurance' }), challengeWorld({ hasOpenAttempt: true }));
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });

		assert('activation succeeds', res.success, true);
		const ins = opsOn(log, 'team_effects', 'insert')[0];
		const v = ins.values as Record<string, unknown>;
		assert('…effect_type insurance, floor_pct 0.5', { effect_type: v.effect_type, payload: v.payload }, {
			effect_type: 'insurance',
			payload: { floor_pct: 0.5 }
		});
		assert('NOT written consumed — active until scoring', v.consumed_at, undefined);
		assert('team_powerups → active', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'active');
	}
}

// ── 8. free_answer — one reveal, one (tab, slot, field) address ──────────────
// powerups.ts:2397-2457: refuses (held) on no attempt, no field, or an
// unresolvable cell; on success, writes ONE already-consumed free_answer row.
async function verifyFreeAnswer() {
	console.log('\n── free_answer: one reveal, addressed by tab/slot/field ───────────');

	{
		const respond = chain(baseRespond({ typeId: 'free_answer' }), challengeWorld({ hasOpenAttempt: false }));
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1', field: 'artist', tabId: 'tab1', slotIndex: 0 });
		assert('no open attempt refuses activation', res.success === false && res.error, 'No active attempt for this challenge');
	}

	{
		// 'label' is not a field of a standard-variant tab — resolveFreeAnswerValue
		// refuses (powerups.ts:1423-1424), and the powerup stays HELD.
		const respond = chain(baseRespond({ typeId: 'free_answer' }), challengeWorld({ hasOpenAttempt: true }));
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1', field: 'label', tabId: 'tab1', slotIndex: 0 });
		assert('a field this tab does not have is refused', res.success === false && res.error, 'This tab has no label field');
		assert('nothing written, powerup stays held', opsOn(log, 'team_effects', 'insert').length, 0);
		assert('…team_powerups untouched', opsOn(log, 'team_powerups', 'update').length, 0);
	}

	{
		const respond = chain(baseRespond({ typeId: 'free_answer' }), challengeWorld({ hasOpenAttempt: true }));
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1', field: 'artist', tabId: 'tab1', slotIndex: 0 });

		assert('activation succeeds', res.success, true);
		assert('revealed value is the track artist', res.revealedValue, 'Angerfist');
		assert('artist tags carried (no artists[] override → falls back to [artist])', res.revealedTags, ['Angerfist']);
		const ins = opsOn(log, 'team_effects', 'insert')[0];
		const v = ins.values as Record<string, unknown>;
		assert('…effect_type free_answer, addressed row', { effect_type: v.effect_type, payload: v.payload }, {
			effect_type: 'free_answer',
			payload: { field: 'artist', value: 'Angerfist', challenge_id: 'ch1', tab_id: 'tab1', slot_index: 0 }
		});
		assert('written ALREADY consumed', v.consumed_at != null, true);
		assert('team_powerups → consumed', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'consumed');
	}
}

// ── 9. x_ray — the activation branch only (budget spend is verify-group-a) ───
// powerups.ts:2459-2512: one x_ray at a time; opens a BUDGET row, status → 'active'
// (not consumed — spendXrayReveal consumes it when the budget hits zero).
async function verifyXrayActivation() {
	console.log('\n── x_ray: opens a budget, held → active (one at a time) ───────────');

	{
		const respond = chain(baseRespond({ typeId: 'x_ray' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return { id: 'existing-xray' };
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1');
		assert('a running X-Ray refuses a second activation', res.success === false && res.error, 'An X-Ray is already running');
		assert('powerup stays held', opsOn(log, 'team_powerups', 'update').length, 0);
	}

	{
		const respond = chain(baseRespond({ typeId: 'x_ray' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return null;
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1');

		assert('activation succeeds', res.success, true);
		assert('default budget is 5', res.payload, { reveals_remaining: 5, reveals_total: 5 });
		assert('team_powerups → active (not consumed)', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'active');
	}

	{
		// resolveXrayBudget reads the per-set override (powerups.ts:189-195).
		const respond = chain(
			baseRespond({ typeId: 'x_ray', powerupConfig: { types: { x_ray: { reveal_budget: 3 } } } }),
			(op) => (op.table === 'team_effects' && op.kind === 'select' ? null : undefined)
		);
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1');
		assert('configured budget of 3 used', res.payload, { reveals_remaining: 3, reveals_total: 3 });
	}
}

// ── 10. free_tab — a batch of reveals, one tab only ───────────────────────────
// powerups.ts:2514-2625: caps at FREE_TAB_MAX_REVEALS (40), refuses a
// multi-tab request, writes one row PER resolved cell.
async function verifyFreeTab() {
	console.log('\n── free_tab: one tab, up to 40 addresses, one row per reveal ──────');

	{
		const respond = chain(baseRespond({ typeId: 'free_tab' }), challengeWorld({ hasOpenAttempt: false }));
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1', revealTargets: [{ tabId: 'tab1', slotIndex: 0, field: 'artist' }] });
		assert('no open attempt refuses activation', res.success === false && res.error, 'No active attempt for this challenge');
	}

	{
		const respond = chain(baseRespond({ typeId: 'free_tab', typeExtra: { name: 'Free Tab' } }), challengeWorld({ hasOpenAttempt: true }));
		const { db } = makeFake(respond);
		const noTargets = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1', revealTargets: [] });
		assert('no targets refused', noTargets.success === false && noTargets.error, 'Free Tab needs at least one answer selected');

		const twoTabs = await activatePowerup(db, 'tp1', {
			currentChallengeId: 'ch1',
			revealTargets: [
				{ tabId: 'tab1', slotIndex: 0, field: 'artist' },
				{ tabId: 'tab2', slotIndex: 0, field: 'title' }
			]
		});
		assert('targets spanning two tabs refused', twoTabs.success === false && twoTabs.error, 'Free Tab reveals one tab, not several');

		const tooMany = await activatePowerup(db, 'tp1', {
			currentChallengeId: 'ch1',
			revealTargets: Array.from({ length: 41 }, (_, i) => ({ tabId: 'tab1', slotIndex: 0, field: `f${i}` }))
		});
		assert('over the 40-reveal cap refused', tooMany.success === false && tooMany.error, 'That is more answers than one tab can have');
	}

	{
		const respond = chain(baseRespond({ typeId: 'free_tab' }), challengeWorld({ hasOpenAttempt: true }));
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', {
			currentChallengeId: 'ch1',
			revealTargets: [
				{ tabId: 'tab1', slotIndex: 0, field: 'artist' },
				{ tabId: 'tab1', slotIndex: 0, field: 'title' },
				{ tabId: 'tab1', slotIndex: 0, field: 'year' }
			]
		});

		assert('activation succeeds', res.success, true);
		assert('three reveals resolved', res.reveals?.length, 3);
		const ins = opsOn(log, 'team_effects', 'insert');
		assert('ONE insert call, batching all rows (array insert)', ins.length, 1);
		const rows = ins[0].values as Record<string, unknown>[];
		assert('three rows written', rows.length, 3);
		assert('every row tagged source=free_tab and already consumed', rows.every((r) => (r.payload as Record<string, unknown>).source === 'free_tab' && r.consumed_at != null), true);
		assert('values match the resolved fields', rows.map((r) => (r.payload as Record<string, unknown>).value), ['Angerfist', 'Incoming Chaos', '2015']);
		assert('team_powerups → consumed', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'consumed');
	}
}

// ── 11. all_seeing_eye — refuse condition + the strip (borderline scope) ─────
async function verifyAllSeeingEyeBorderline() {
	console.log('\n── all_seeing_eye: refuses on an empty room, held ──────────────────');

	// powerups.ts:2647-2653: resolveAllSeeingEye() returns [] when no other team
	// has finished; refuse BEFORE any write.
	{
		const respond = chain(baseRespond({ typeId: 'all_seeing_eye' }), (op) => {
			if (op.table === 'submissions' && op.kind === 'select') return [];
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('no finished team refuses activation', res.success === false && res.error, 'No other team has finished this challenge yet — the Eye sees nothing. Try again later.');
		assert('nothing written', opsOn(log, 'team_effects', 'insert').length, 0);
		assert('powerup stays held', opsOn(log, 'team_powerups', 'update').length, 0);
	}

	console.log('\n── all_seeing_eye: happy path — a CONSUMED snapshot, stripped at write ─');

	// The write side the refusal test above never reaches (R1 gap 2). Raw answers
	// another team submitted, deliberately carrying the decided half — so the
	// "stored snapshot is stripped" assert below cannot pass vacuously on input
	// that had nothing to strip.
	const RAW_EYE_ANSWERS = [
		{
			tab_position: 0,
			breakdown: { final: 30 },
			source_answers: [
				{
					slot_index: 0,
					field_values: { artist: 'Rooler', title: 'Sound Barrier' },
					scored: { artist: 15, title: 15 },
					total: 30,
					matched_source_track_id: 'trk9'
				}
			]
		}
	];
	const EYE_FORBIDDEN = ['scored', 'total', 'breakdown', 'matched_source_track_id', 'track_id'];
	const keysDeep = (value: unknown, acc: Set<string> = new Set()): Set<string> => {
		if (Array.isArray(value)) for (const v of value) keysDeep(v, acc);
		else if (value && typeof value === 'object') {
			for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
				acc.add(k);
				keysDeep(v, acc);
			}
		}
		return acc;
	};
	const forbiddenIn = (value: unknown) => EYE_FORBIDDEN.filter((k) => keysDeep(value).has(k));

	const eyeWorld = (op: Op) => {
		if (op.table === 'submissions' && op.kind === 'select')
			return [{ team_id: 'team2', answers: RAW_EYE_ANSWERS, score: 30 }];
		if (op.table === 'teams' && op.kind === 'select')
			return [{ id: 'team2', display_name: 'Blauw', color: 'blue' }];
		return undefined;
	};

	// show_scores at its default (off): the stored entries carry NO score key.
	{
		const respond = chain(baseRespond({ typeId: 'all_seeing_eye' }), eyeWorld);
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });

		assert('activation succeeds when another team has finished', res.success, true);
		const ins = opsOn(log, 'team_effects', 'insert');
		assert('exactly one snapshot row written (the write really fired)', ins.length, 1);
		const v = ins[0].values as Record<string, unknown>;
		assert('…effect_type all_seeing_eye', v.effect_type, 'all_seeing_eye');
		// THE mutation-caught pair: the snapshot is written ALREADY consumed so it
		// can never surface via loadActiveEffects, and the powerup is spent on the
		// look — not parked 'active'.
		assert('written ALREADY consumed — a snapshot, not a live effect', v.consumed_at != null, true);
		assert('…consumed against this challenge', v.consumed_challenge_id, 'ch1');
		assert('…traceable to the powerup', v.source_team_powerup_id, 'tp1');
		assert(
			'team_powerups → consumed (spent on the look)',
			(opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status,
			'consumed'
		);

		const payload = v.payload as {
			challenge_id?: string;
			teams?: Array<Record<string, unknown>>;
		};
		assert('payload addressed to this challenge', payload.challenge_id, 'ch1');
		assert('payload carries the one finished team', payload.teams?.length, 1);
		assert(
			'…identified for the panel (id, name, color)',
			{
				teamId: payload.teams?.[0]?.teamId,
				displayName: payload.teams?.[0]?.displayName,
				color: payload.teams?.[0]?.color
			},
			{ teamId: 'team2', displayName: 'Blauw', color: 'blue' }
		);
		const slot = (
			(payload.teams?.[0]?.tabs as Array<{ slots: Array<Record<string, unknown>> }>) ?? []
		)[0]?.slots?.[0];
		assert('typed values survive into the snapshot', slot?.fieldValues, {
			artist: 'Rooler',
			title: 'Sound Barrier'
		});
		// Anti-vacuity first, then the strip claim: the input demonstrably carried
		// the decided half, and none of it reached the stored payload.
		assert('the raw input really did carry scoring data', forbiddenIn(RAW_EYE_ANSWERS).length > 0, true);
		assert('the STORED snapshot leaks no forbidden key', forbiddenIn(payload), []);
		assert(
			'show_scores default off → no score key stored',
			payload.teams?.some((t) => 'score' in t),
			false
		);
	}

	// show_scores switched on for the set: the stored entry carries the score.
	{
		const respond = chain(
			baseRespond({
				typeId: 'all_seeing_eye',
				powerupConfig: { types: { all_seeing_eye: { show_scores: true } } }
			}),
			eyeWorld
		);
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('activation succeeds with show_scores on', res.success, true);
		const v = opsOn(log, 'team_effects', 'insert')[0]?.values as Record<string, unknown>;
		const teams = (v?.payload as { teams?: Array<Record<string, unknown>> })?.teams;
		assert('show_scores=true → the stored entry carries the score', teams?.[0]?.score, 30);
		assert('…and still leaks nothing decided', forbiddenIn(v?.payload), []);
	}

	console.log('\n── all_seeing_eye: the strip is an allowlist, not a delete-list ───');

	// stripAnswersForEye (powerups.ts:255-294) is pure — driven directly, no fake
	// needed. Independent oracle: the function's OWN doc comment names exactly
	// what must survive (field_values, fragments) and what must never leave the
	// server (scored, total, breakdown, matched_source_track_id, track_id,
	// submissions.status) — asserted here by constructing a raw submission that
	// carries BOTH halves and checking only the allowed half comes back.
	{
		const currentShapeAnswers = [
			{
				tab_position: 0,
				source_answers: [
					{
						slot_index: 0,
						field_values: { artist: 'Angerfist', title: 'Incoming Chaos', year: '2015' },
						fragments: [1, 2],
						// The decided half — must NOT survive the strip.
						scored: { artist: 10, title: 10, year: 10 },
						total: 30,
						breakdown: { final: 30 },
						matched_source_track_id: 'trk1'
					}
				]
			}
		];
		const stripped = stripAnswersForEye(currentShapeAnswers);
		assert('one tab, one slot', { tabs: stripped.length, slots: stripped[0]?.slots.length }, { tabs: 1, slots: 1 });
		assert('field_values survives verbatim', stripped[0].slots[0].fieldValues, { artist: 'Angerfist', title: 'Incoming Chaos', year: '2015' });
		assert('fragments survives (player input)', stripped[0].slots[0].fragments, [1, 2]);
		assert('the slot has EXACTLY slotIndex + fieldValues + fragments — nothing decided leaks', Object.keys(stripped[0].slots[0]).sort(), ['fieldValues', 'fragments', 'slotIndex']);

		// Legacy pre-0036 shape: field_values sits directly on the tab entry, plus
		// the same decided-half fields and the sharpest leak of all, track_id.
		const legacyShapeAnswers = [
			{
				tab_position: 0,
				field_values: { artist: 'Angerfist' },
				scored: { artist: 10 },
				total: 10,
				matched_source_track_id: 'trk1',
				track_id: 'trk1'
			}
		];
		const strippedLegacy = stripAnswersForEye(legacyShapeAnswers);
		assert('legacy shape: field_values survives', strippedLegacy[0].slots[0].fieldValues, { artist: 'Angerfist' });
		assert('legacy shape: nothing decided leaks either', Object.keys(strippedLegacy[0].slots[0]).sort(), ['fieldValues', 'slotIndex']);

		// Failing closed: unrecognisable input yields an empty list, not a partial copy.
		assert('non-array input fails closed to []', stripAnswersForEye({ not: 'an array' }), []);
		assert('a tab with neither shape is dropped entirely (no partial/empty tab)', stripAnswersForEye([{ tab_position: 0, nonsense: true }]), []);
	}
}

// ── 12. resurrection — the reverse-flow activation ────────────────────────────
// powerups.ts:2689-2846: guard 1 (one open ticket), guard 2 (a finished
// submission to reopen), then ticket → CAS unlock → attempt restart, in that
// order, with rollback if the CAS is lost.
async function verifyResurrection() {
	console.log('\n── resurrection: guards, then ticket → unlock → restarted attempt ─');

	{
		const respond = chain(baseRespond({ typeId: 'resurrection' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return [{ id: 'open-ticket' }];
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('an already-open retry refuses a second one', res.success === false && res.error, 'You already have a challenge back from the dead — finish that one first');
		assert('a refusal logs no resurrection_opened', opsOn(log, 'activity_log', 'insert').length, 0);
	}

	{
		const respond = chain(baseRespond({ typeId: 'resurrection' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return [];
			if (op.table === 'submissions' && op.kind === 'select') return null;
			return undefined;
		});
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('no submission at all refuses (nothing to bring back)', res.success === false && res.error, 'You have not finished that challenge yet — there is nothing to bring back');
	}

	{
		const respond = chain(baseRespond({ typeId: 'resurrection' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return [];
			if (op.table === 'submissions' && op.kind === 'select') return { id: 'sub1', answers: [], score: 0, is_final: false };
			return undefined;
		});
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('a non-final (already open) submission refuses', res.success === false && res.error, 'That challenge is already open — go and play it');
	}

	{
		// Happy path: is_final submission with a real breakdown.final; CAS unlock
		// succeeds; timed challenge → retrySeconds = round(timerSeconds/3).
		const respond = chain(baseRespond({ typeId: 'resurrection' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return [];
			if (op.table === 'submissions' && op.kind === 'select') {
				return { id: 'sub1', answers: [{ breakdown: { final: 42 } }], score: 0, is_final: true };
			}
			if (op.table === 'challenges' && op.kind === 'select') return { timer_seconds: 90 };
			if (op.table === 'submissions' && op.kind === 'update') return [{ id: 'sub1' }]; // CAS wins
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });

		assert('activation succeeds', res.success, true);
		const ticketIns = opsOn(log, 'team_effects', 'insert')[0];
		const v = ticketIns.values as Record<string, unknown>;
		assert('…ticket effect_type resurrection, old_final read BEFORE the reopen', {
			effect_type: v.effect_type,
			old_final: (v.payload as Record<string, unknown>).old_final,
			score_mode: (v.payload as Record<string, unknown>).score_mode,
			retry_seconds: (v.payload as Record<string, unknown>).retry_seconds
		}, { effect_type: 'resurrection', old_final: 42, score_mode: 'replace', retry_seconds: 30 });
		assert('ticket NOT written consumed — it IS the open retry', v.consumed_at, undefined);
		const subUpd = opsOn(log, 'submissions', 'update')[0];
		assert('submission unlock: is_final → false, CAS on is_final=true', {
			values: subUpd.values,
			filters: subUpd.filters
		}, { values: { is_final: false }, filters: { id: 'sub1', is_final: true } });
		assert('attempt restarted via upsert', opsOn(log, 'challenge_attempts', 'upsert').length, 1);
		assert('team_powerups → active (spent only when the retry settles)', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'active');
		// Bound on NAME and CONTENT, not just counted (R1 gap 3): any stray
		// activity_log insert used to satisfy this. Oracle hand-derived from the
		// fixture: old_final 42 (the breakdown the responder serves), default
		// score_mode 'replace', retry 90s/3 = 30s.
		const logged = opsOn(log, 'activity_log', 'insert');
		assert('exactly one activity_log row', logged.length, 1);
		assert(
			'…logged as resurrection_opened carrying the ticket facts',
			{
				event_type: (logged[0]?.values as { event_type?: string })?.event_type,
				payload: (logged[0]?.values as { payload?: Record<string, unknown> })?.payload
			},
			{
				event_type: 'resurrection_opened',
				payload: { old_final: 42, score_mode: 'replace', retry_seconds: 30 }
			}
		);
	}

	{
		// The rollback: the CAS is lost (someone else already reopened it) → the
		// ticket that was just inserted is DELETED, and the powerup stays held.
		const respond = chain(baseRespond({ typeId: 'resurrection' }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return [];
			if (op.table === 'submissions' && op.kind === 'select') {
				return { id: 'sub1', answers: [{ breakdown: { final: 42 } }], score: 0, is_final: true };
			}
			if (op.table === 'challenges' && op.kind === 'select') return { timer_seconds: 90 };
			if (op.table === 'team_effects' && op.kind === 'insert') return { id: 'ticket1' };
			if (op.table === 'submissions' && op.kind === 'update') return []; // CAS lost
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });

		assert('lost CAS refuses activation', res.success === false && res.error, 'That challenge is already open — go and play it');
		assert('the ticket is rolled back with a delete', opsOn(log, 'team_effects', 'delete').length, 1);
		assert('no attempt restart happened', opsOn(log, 'challenge_attempts', 'upsert').length, 0);
		assert('powerup stays held', opsOn(log, 'team_powerups', 'update').length, 0);
		assert('a lost CAS logs no resurrection_opened', opsOn(log, 'activity_log', 'insert').length, 0);
	}

	{
		// resolveResurrectionScoreMode: a set configured to 'best' is honoured.
		const respond = chain(baseRespond({ typeId: 'resurrection', powerupConfig: { types: { resurrection: { score_mode: 'best' } } } }), (op) => {
			if (op.table === 'team_effects' && op.kind === 'select') return [];
			if (op.table === 'submissions' && op.kind === 'select') {
				return { id: 'sub1', answers: [{ breakdown: { final: 10 } }], score: 0, is_final: true };
			}
			if (op.table === 'challenges' && op.kind === 'select') return { timer_seconds: null }; // untimed
			if (op.table === 'submissions' && op.kind === 'update') return [{ id: 'sub1' }];
			return undefined;
		});
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('configured score_mode=best is used', res.resurrection?.scoreMode, 'best');
		assert('untimed challenge → retrySeconds null (no clock to divide)', res.resurrection?.retrySeconds, null);
	}
}

// ── 13. lifeline — the time gate, then masked hints ───────────────────────────
// powerups.ts:2848-2926: LIFELINE_MIN_ELAPSED_FRACTION=0.5 gates activation;
// hints are written ALREADY consumed, one per wrong/empty cell.
async function verifyLifeline() {
	console.log('\n── lifeline: gated at 50% elapsed, then masked hints ───────────────');

	{
		const respond = chain(baseRespond({ typeId: 'lifeline' }), challengeWorld({ hasOpenAttempt: false }));
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('no open attempt refuses (needs a timed challenge already started)', res.success === false && res.error, 'Lifeline needs a timed challenge you have already started');
	}

	{
		// 40% elapsed of a 100s challenge — below the 50% gate.
		const respond = chain(baseRespond({ typeId: 'lifeline' }), challengeWorld({ hasOpenAttempt: true, timerSeconds: 100, elapsedFraction: 0.4 }));
		const { db } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1' });
		assert('under 50% elapsed refuses with a countdown message', res.success === false && typeof res.error === 'string' && res.error.startsWith('Too early — Lifeline unlocks halfway through.'), true);
	}

	{
		// 90% elapsed, but the draft already has every field exactly right → no
		// hints to give (powerups.ts:2889-2890).
		const respond = chain(baseRespond({ typeId: 'lifeline' }), challengeWorld({ hasOpenAttempt: true, timerSeconds: 100, elapsedFraction: 0.9 }));
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', {
			currentChallengeId: 'ch1',
			lifelineDraft: { '0': [{ fieldValues: { artist: 'Angerfist', title: 'Incoming Chaos', year: '2015' } }] }
		});
		assert('everything already correct refuses (nothing to hint at)', res.success === false && res.error, 'Nothing left to hint at — you have them all right!');
		assert('nothing written', opsOn(log, 'team_effects', 'insert').length, 0);
	}

	{
		const respond = chain(baseRespond({ typeId: 'lifeline' }), challengeWorld({ hasOpenAttempt: true, timerSeconds: 100, elapsedFraction: 0.9 }));
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { currentChallengeId: 'ch1', lifelineDraft: {} });

		assert('activation succeeds', res.success, true);
		// Independent oracle for the mask, hand-applied from maskAnswer's own rule
		// (powerups-meta.ts:186-205: first char of every word kept, rest underscored):
		//   "Angerfist"       -> "A________"        (9 chars, 1 kept + 8 underscored)
		//   "Incoming Chaos"  -> "I_______ C____"    (8+1 space+5)
		//   "2015"            -> "2___"
		assert('3 hints, one per field', res.lifelineHints?.length, 3);
		const byField = Object.fromEntries((res.lifelineHints ?? []).map((h) => [h.field, h.mask]));
		assert('artist mask', byField.artist, 'A________');
		assert('title mask', byField.title, 'I_______ C____');
		assert('year mask', byField.year, '2___');
		// Cross-check against maskAnswer() called directly — same function, values
		// independently computed above rather than trusted from the activation call.
		assert('maskAnswer("Angerfist") matches the hand-derived mask', maskAnswer('Angerfist'), byField.artist);

		const ins = opsOn(log, 'team_effects', 'insert')[0];
		const v = ins.values as Record<string, unknown>;
		assert('…effect_type lifeline, addressed to this challenge', { effect_type: v.effect_type, challenge_id: (v.payload as Record<string, unknown>).challenge_id }, { effect_type: 'lifeline', challenge_id: 'ch1' });
		assert('written ALREADY consumed', v.consumed_at != null, true);
		assert('team_powerups → consumed', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'consumed');
	}
}

// ── 14. power_spin — rolls another powerup via materializeAward ──────────────
// powerups.ts:2058-2150: an empty wheel still consumes the spin; a hit hands
// off to materializeAward (a team_powerups insert, NOT itself re-tested here —
// that insert path is exercised directly by the earning-gap checks below via
// planAwards/materializeAward's own caller, awardPowerups, and by the "happy
// path" assertion here that a team_powerups row is inserted with the rolled type).
async function verifyPowerSpin() {
	console.log('\n── power_spin: empty wheel still consumes; a hit awards a powerup ─');

	{
		// Every Tier A/S type disabled for this set → both tiers empty.
		const respond = chain(baseRespond({ typeId: 'power_spin', powerupConfig: { categories: { defensive: false, offensive: false, punishment: false, self: false } } }), (op) => {
			if (op.table === 'powerup_types' && op.kind === 'select' && op.cols === '*') {
				return [
					{ id: 'shield', tier: 'A', category: 'defensive', coming_soon: false, enabled_by_default: true },
					{ id: 'hard_gaan', tier: 'A', category: 'self', coming_soon: false, enabled_by_default: true }
				];
			}
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { rand: () => 0.99 }); // rolls Tier A (S chance 0.15)

		assert('activation succeeds even on an empty wheel', res.success, true);
		assert('nothing landed', res.spun, undefined);
		assert('payload reports the empty wheel', res.payload, { rolled_tier: 'A', used_tier: null, rolled_type_id: null, rolled_type_name: null });
		assert('the SPIN itself is still consumed', (opsOn(log, 'team_powerups', 'update')[0]?.values as { status?: string })?.status, 'consumed');
		assert('no powerup was awarded', opsOn(log, 'team_powerups', 'insert').length, 0);
	}

	{
		// One eligible, holdable, non-immediate Tier A type — the simplest
		// materializeAward path (insert 'pending', no recursive activation).
		let insertedId = 0;
		const respond = chain(baseRespond({ typeId: 'power_spin' }), (op) => {
			if (op.table === 'powerup_types' && op.kind === 'select' && op.cols === '*') {
				return [{ id: 'spin_target', tier: 'A', category: 'defensive', coming_soon: false, enabled_by_default: true, holdable: true, immediate_use: false, icon: '🎯', name: 'Spin Target' }];
			}
			if (op.table === 'team_powerups' && op.kind === 'insert') {
				insertedId += 1;
				return { id: `spun-${insertedId}` };
			}
			return undefined;
		});
		const { db, log } = makeFake(respond);
		const res = await activatePowerup(db, 'tp1', { rand: () => 0.99 }); // Tier A, only member of the pool

		assert('activation succeeds', res.success, true);
		assert('the spin landed on the one eligible type', res.spun?.type.id, 'spin_target');
		assert('spun powerup materialized via team_powerups insert', opsOn(log, 'team_powerups', 'insert').length, 1);
		assert('…as pending (holdable, not immediate_use)', (opsOn(log, 'team_powerups', 'insert')[0].values as Record<string, unknown>).status, 'pending');
		assert('power_spin event logged with the rolled type', (opsOn(log, 'activity_log', 'insert')[0]?.values as { payload?: Record<string, unknown> })?.payload?.rolled_type_id, 'spin_target');
		assert('the SPIN itself consumed', (opsOn(log, 'team_powerups', 'update').find((u) => (u.values as { status?: string }).status === 'consumed')) != null, true);
	}
}

// The earning gap (lifeline + penalty_shot's inverse channel, fase 1b step 2)
// is covered separately in verify-earning-inverse.ts — it needs none of this
// file's activatePowerup/fake-client machinery (planAwards is pure), so it is
// its own commit and its own npm script rather than bolted on here.

async function main() {
	await verifyBonusPoints();
	await verifySingleEventMult();
	await verifyHardGaan();
	await verifyShield();
	await verifyDoubleDown();
	await verifyTimeBoost();
	await verifyInsurance();
	await verifyFreeAnswer();
	await verifyXrayActivation();
	await verifyFreeTab();
	await verifyAllSeeingEyeBorderline();
	await verifyResurrection();
	await verifyLifeline();
	await verifyPowerSpin();

	const failed = checks.filter((c) => !c.pass);
	console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
	if (failed.length) {
		for (const f of failed) console.log(`  ✗ ${f.name}: ${f.detail}`);
		process.exit(1);
	}
}

void main();
