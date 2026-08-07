import type { FieldResult } from '$lib/types/index.js';

// ─── Threshold-grensregel (C3a-2) ─────────────────────────────────────────────
//
// The SINGLE source of truth for "which of a slot's field points count toward the
// threshold" — the bonus-excluded pair that feeds the powerup-earn % (its
// numerator/denominator) and the auto_correct gate. Previously copied verbatim
// into three places (scoreTab in $lib/server/scoring.ts, the priorResult rebuild
// in the challenge +page.server.ts, and the client-fallback in +page.svelte);
// C3a-1 fixed a drift between the first two, C3a-2 consolidates so they can't
// diverge again.
//
// Deliberately client-safe and pure: it lives OUTSIDE $lib/server so the browser
// bundle (+page.svelte) can import it — no Supabase client, no $env secrets, no
// server-only imports. It operates only on the passed FieldResult[].
//
// Two kinds of bonus are excluded here:
//   1. WHOLE-field bonus (fr.isBonus) — skipped entirely.
//   2. PARTIAL bonus inside a threshold field (fr.bonusScore) — the bonus-artist
//      points inside the artist field (C1 stuk 1). Subtracted from the TOTAL so a
//      bonus artist still counts toward the team's points (fr.score includes it)
//      but can't demote a perfect main answer from auto_correct or move the
//      earning %.
//
// The max needs NO bonus subtraction: fr.maxScore is base-only since the C1 stuk 2
// correction. Both default gracefully (bonusScore ?? 0), so every pre-C1 field
// sums exactly as it did.
//
// Scope: this is the per-slot FieldResult fold ONLY. Grouping (scored separately
// from a non-FieldResult source), overflow/unmatched-slot max, and the
// no-track-no-FieldResult behaviour stay at each call site — those are not shared
// verbatim and folding them in would change behaviour.
export function thresholdOfFields(frs: FieldResult[]): { total: number; max: number } {
	let total = 0;
	let max = 0;
	for (const fr of frs) {
		if (fr.isBonus) continue;
		total += fr.score - (fr.bonusScore ?? 0);
		max += fr.maxScore;
	}
	return { total, max };
}

// ─── Field-correct count (migration 0077) ────────────────────────────────────
//
// The same fold, counting FIELDS instead of POINTS: how many of a slot's fields
// the team got right, out of how many it could have. Persisted per submission so
// a per-team "average % of fields correct" is one aggregation later.
//
// It lives beside thresholdOfFields because it inherits that function's
// exclusions verbatim — same bonus rule, same per-slot FieldResult scope — and
// splitting the two would let the pair drift the way C3a-1 found them drifting.

/**
 * Did this field earn its FULL points?
 *
 * The predicate behind both callers of "correct": the lifeline powerup asking
 * which cell deserves a hint (fieldIsFullyCorrect in $lib/server/scoring.ts,
 * which now delegates here) and the 0077 field count. One implementation on
 * purpose — a second notion of "correct" would be free to drift from the one
 * that awards the points, and then a team would get a hint on a field it had
 * already nailed while the count called that same field wrong.
 *
 * FULL points, not "any points", is the bar. A year one off scores 50% and a
 * 65%-similar title scores 50%; both are wrong answers that deserve a hint, so
 * partial credit counts as wrong here too. This is the bar the codebase already
 * set — no new threshold is introduced.
 *
 * Three guards before the comparison:
 *   - grouping has no per-track answer (it is scored across the whole tab), so
 *     there is nothing to be right about at this granularity.
 *   - a blank answer is never correct, whatever the scorer makes of it.
 *   - a 0-point field cannot be "fully correct" in any useful sense; without
 *     this, score(0) >= max(0) would call every blank answer correct.
 *
 * The artist field is why `score` alone will not do: scoreField folds
 * bonus-artist points into it, so a team that missed one of two main artists but
 * guessed a bonus artist could reach maxScore without having the answer right.
 * Subtracting bonusScore leaves exactly the main score, which is the part
 * measured against maxScore.
 */
export function fieldResultIsFullyCorrect(
	fr: Pick<FieldResult, 'field' | 'submitted' | 'score' | 'maxScore'> &
		Partial<Pick<FieldResult, 'bonusScore'>>
): boolean {
	if (fr.field === 'grouping') return false;
	if (!fr.submitted.trim()) return false;
	if (fr.maxScore <= 0) return false;
	return fr.score - (fr.bonusScore ?? 0) >= fr.maxScore;
}

/**
 * How many of a slot's fields were fully correct, and how many were countable.
 *
 * Exclusions mirror thresholdOfFields, for the same reasons:
 *   - BONUS fields (fr.isBonus) leave both numerator and denominator. Bonus work
 *     is optional, so counting it in the denominator would penalise a team for
 *     skipping what was never required — and it would decouple this ratio from
 *     the earn-%, which already excludes it.
 *   - GROUPING never reaches here (buildFieldResults filters it out, and the
 *     predicate above rejects it anyway), so it is in neither half.
 *
 * A wrong or blank answer still counts in `total`: 0 out of 3 is a measured 0%,
 * which is precisely the data point a safety-net condition needs. Only a field
 * that could never be answered at all is left out entirely, which is why the
 * empty-slot cases are handled at the scoreTab call sites rather than here —
 * exactly like the overflow/unmatched max.
 */
export function correctCountOfFields(frs: FieldResult[]): { correct: number; total: number } {
	let correct = 0;
	let total = 0;
	for (const fr of frs) {
		if (fr.isBonus) continue;
		if (fr.field === 'grouping') continue;
		total++;
		if (fieldResultIsFullyCorrect(fr)) correct++;
	}
	return { correct, total };
}
