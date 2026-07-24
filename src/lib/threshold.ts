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
