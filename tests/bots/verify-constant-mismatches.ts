// Card-vs-code constant mismatches — bonus_points and single_event_mult.
//
//   npm run bots:verify-constant-mismatches
//
// NO database, NO app, NO mutation. Same instrument as
// verify-activation-self-defensive.ts: the REAL activatePowerup() is driven
// against a recording fake Supabase client, and the payload it writes is
// asserted against the value the CARD promises — read from
// powerup_types.description, never imported from the activation code.
//
// ── THE TWO PROMISES UNDER TEST ───────────────────────────────────────────────
//   bonus_points      "+5 points to your team immediately."
//   single_event_mult "Random multiplier (x1.2/x1.4/x1.6) applied to your next
//                      challenge."
//
// The first is a flat literal. The second is the interesting one: the card
// promises a ROLL over three values, so a fixed multiplier is a broken promise
// however plausible the number. `rand` is injectable through
// ActivateOptions.rand for exactly the same reason rollDice's is (see
// powerups.ts:247-258) — a test can pin each of the three outcomes instead of
// sampling and hoping.
//
// ── WHAT A GREEN RUN PROVES ───────────────────────────────────────────────────
// (1) activation writes the promised value into team_effects.payload, and
// (2) that written value — not an assumption — survives the whole scoring
//     chain: payload → deriveEffectModifiers → BonusParams.extraMultipliers →
//     computeBreakdown's additive-delta → breakdown.powerup_multipliers.
// Step 2 is what makes this more than a literal check: it rules out the failure
// where activation rolls 1.2 but the scorer still applies something else.

import { activatePowerup, deriveEffectModifiers, type ActiveEffect } from '../../src/lib/server/powerups';
import { computeBreakdown, type BonusParams } from '../../src/lib/server/scoring';
import { makeFake, makeAsserter, opsOn, type Op, type Responder } from './fake-supabase';

const { checks, assert } = makeAsserter();

/** team_powerups + powerup_types + game_sets — the three reads activatePowerup
 * does before it reaches the type switch. Copied in shape from
 * verify-activation-self-defensive.ts's baseRespond; trimmed to what these two
 * types need (neither reads a challenge, a track or another effect row). */
function baseRespond(typeId: string): Responder {
	return (op: Op) => {
		if (op.table === 'team_powerups' && op.kind === 'select') {
			return {
				id: 'tp1',
				team_id: 'team1',
				set_id: 'set1',
				powerup_type_id: typeId,
				status: 'held'
			};
		}
		if (op.table === 'powerup_types' && op.kind === 'select') {
			if (Object.keys(op.filters).length === 0) return undefined;
			return { id: typeId, name: typeId };
		}
		if (op.table === 'game_sets' && op.kind === 'select') {
			return { status: 'active', play_state: 'playing', powerup_config: {} };
		}
		if (op.table === 'team_effects' && op.kind === 'insert') return { id: 'eff1' };
		return null;
	};
}

/** Run the real activation and hand back both the result payload and the row it
 * inserted into team_effects — the two places the value has to agree. */
async function activate(typeId: string, rand?: () => number) {
	const { db, log } = makeFake(baseRespond(typeId));
	const res = await activatePowerup(db, 'tp1', rand ? { rand } : undefined);
	const ins = opsOn(log, 'team_effects', 'insert');
	return { res, inserted: (ins[0]?.values ?? {}) as Record<string, unknown> };
}

/** Neutral bonus: difficulty 3 → 1.0×, round 1×, comeback 1.0× (no leader), no
 * streak, no speed. Every other delta is 0, so `final` isolates the powerup. */
const neutralBonus = (over: Partial<BonusParams> = {}): BonusParams => ({
	difficulty_rating: 3,
	challenge_multiplier: 1,
	team_score: 0,
	leader_score: 0,
	current_streak: 0,
	streak_thresholds: [],
	elapsed_seconds: null,
	speed_threshold_seconds: null,
	...over
});

/** The team_effects row as loadActiveEffects would hand it back to the scorer. */
function asEffect(effectType: string, payload: Record<string, unknown>): ActiveEffect {
	return {
		id: 'eff1',
		effect_type: effectType,
		payload,
		expires_at: null,
		source_team_powerup_id: 'tp1'
	};
}

// ── 1. bonus_points — the card says +5 ────────────────────────────────────────
async function verifyBonusPoints() {
	console.log('\n── bonus_points: card promises "+5 points" ──────────────────────');
	const { res, inserted } = await activate('bonus_points');

	assert('activation succeeds', res.success, true);
	assert('payload is the flat value the card promises', res.payload, { value: 5 });
	assert('…and the same value reaches team_effects', inserted.payload, { value: 5 });

	// Through the scorer: deriveEffectModifiers → bonusPoints → flat add after
	// the multiplied total (scoring.ts:1291-1292).
	const mods = deriveEffectModifiers([asEffect('bonus_points', inserted.payload as Record<string, unknown>)]);
	assert('deriveEffectModifiers reads +5 back', mods.bonusPoints, 5);
	const b = computeBreakdown(100, neutralBonus({ bonusPoints: mods.bonusPoints }));
	assert('base 100 + 5 → final 105', b.final, 105);
	assert('breakdown records the flat bonus', b.bonus_powerup, 5);

	// The fallback deriveEffectModifiers applies when a row carries no value at
	// all must agree with the card too, or a malformed row silently pays the old
	// amount (powerups.ts:1035-1039).
	const noPayload = deriveEffectModifiers([asEffect('bonus_points', {})]);
	assert('empty payload falls back to +5, not the old +15', noPayload.bonusPoints, 5);
}

// ── 2. single_event_mult — the card promises a ROLL ───────────────────────────
// rand is pinned, so each of the three promised outcomes is an assertion rather
// than a sample. Index = floor(rand × 3) over [1.2, 1.4, 1.6].
async function verifySingleEventMult() {
	console.log('\n── single_event_mult: card promises x1.2 / x1.4 / x1.6 ──────────');

	const ROLLS: Array<{ rand: number; want: number; note: string }> = [
		{ rand: 0, want: 1.2, note: 'rand=0 → lowest' },
		{ rand: 0.5, want: 1.4, note: 'rand=0.5 → middle' },
		{ rand: 0.999999999, want: 1.6, note: 'rand→1 → highest' }
	];

	for (const r of ROLLS) {
		const { res, inserted } = await activate('single_event_mult', () => r.rand);
		assert(`${r.note}: payload multiplier is ×${r.want}`, res.payload, { multiplier: r.want });
		assert(`${r.note}: the same ×${r.want} reaches team_effects`, inserted.payload, {
			multiplier: r.want
		});

		// The rolled value has to be the one the scorer applies. Additive-delta
		// (scoring.ts:1255-1276): base × (1 + Σ(m_i − 1)) — with a neutral bonus
		// that is exactly base × m.
		const mods = deriveEffectModifiers([
			asEffect('single_event_mult', inserted.payload as Record<string, unknown>)
		]);
		assert(`${r.note}: deriveEffectModifiers reads ×${r.want} back`, mods.extraMultipliers, [
			r.want
		]);
		const b = computeBreakdown(100, neutralBonus({ extraMultipliers: mods.extraMultipliers }));
		assert(`${r.note}: base 100 → final ${Math.round(100 * r.want)}`, b.final, Math.round(100 * r.want));
		assert(`${r.note}: breakdown shows the ROLLED multiplier`, b.powerup_multipliers, [r.want]);
	}

	// The roll must be the only thing that varies: two pins on the same value
	// must agree, and the three pins above must not all be the same number —
	// a constant would satisfy every individual equality above if the expected
	// values were wrong, but not this.
	const seen = new Set<number>();
	for (const r of ROLLS) {
		const { res } = await activate('single_event_mult', () => r.rand);
		seen.add((res.payload as { multiplier?: number })?.multiplier as number);
	}
	assert('three pins produce three distinct multipliers', seen.size, 3);

	// The effect is one-shot: it is consumed on the submission it multiplies,
	// unchanged by this fix (powerups.ts:1024-1029). Guarded so the roll cannot
	// quietly turn it into a window effect.
	const { inserted } = await activate('single_event_mult', () => 0);
	assert('no expires_at — still one-shot, not a window', inserted.expires_at, undefined);
	const mods = deriveEffectModifiers([
		asEffect('single_event_mult', inserted.payload as Record<string, unknown>)
	]);
	assert('…and still marked for consumption after scoring', mods.toConsume.length, 1);
}

// ── 3. hard_gaan — code stays ×1.5, only its card text moves ──────────────────
// Migration 0076 rewrites the description to x1.5. That is a text change; the
// code must NOT drift with it, so this pins the multiplier the card will now
// claim.
async function verifyHardGaanUnchanged() {
	console.log('\n── hard_gaan: code stays ×1.5 (card catches up in 0076) ─────────');
	const { db, log } = makeFake((op: Op) => {
		const base = baseRespond('hard_gaan')(op);
		if (op.table === 'game_sets' && op.kind === 'select') {
			return { status: 'active', play_state: 'playing', powerup_config: {}, hard_gaan_window_minutes: 15 };
		}
		return base;
	});
	const res = await activatePowerup(db, 'tp1');
	assert('activation succeeds', res.success, true);
	assert('multiplier is ×1.5, matching the new card text', (res.payload as { multiplier?: number })?.multiplier, 1.5);
	assert('window is 15 minutes, matching the card text', (res.payload as { window_minutes?: number })?.window_minutes, 15);
	const ins = opsOn(log, 'team_effects', 'insert');
	assert('window effect carries expires_at', typeof (ins[0]?.values as Record<string, unknown>)?.expires_at, 'string');
}

async function main() {
	await verifyBonusPoints();
	await verifySingleEventMult();
	await verifyHardGaanUnchanged();

	console.log('');
	for (const c of checks) {
		console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(64)} ${c.pass ? '' : c.detail}`);
	}
	const passed = checks.filter((c) => c.pass).length;
	console.log(`\n${passed}/${checks.length} checks passed\n`);
	process.exit(passed === checks.length ? 0 : 1);
}

main();
