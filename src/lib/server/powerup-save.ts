// Parsing and patching for the per-type powerup override — the pure half of
// ?/saveTypeConfig.
//
// Split out of the action so the two properties that matter can be asserted
// without a database or a browser (tests/bots/verify-earn-form.ts):
//
//   a save writes ONLY what was sent      — nothing else in the override moves
//   an empty field CLEARS its key         — rather than being skipped
//
// ── Why "empty means clear" had to be added ─────────────────────────────────
// Every field used to be skipped when it arrived empty (`if (diceMinRaw)`), so
// a stored override could be changed but never removed. There was no way back to
// a default from the console: a host who set a weight of 3 to try something out
// was stuck with 3, because typing nothing and blurring saved nothing. The
// resolvers all treat an ABSENT key as "use the default", so removing the key is
// exactly what "back to default" means — the value cannot be written as a
// sentinel, it has to go.
//
// The distinction the parser rests on is one HTML gives for free:
//
//   absent ('null')  the form did not carry this field  → leave the key alone
//   present, empty   the host emptied the box           → delete the key
//   present, valid   → write it
//   present, invalid → leave the key alone (see below)
//
// That first case is load-bearing: the compact card's on/off form posts only
// `enabled`, and it must not wipe the four earn keys it does not know about.
//
// ── Why invalid input leaves the key alone ──────────────────────────────────
// Not "clear it", which would silently discard a good stored value because of a
// typo, and not "store it", which is what the console did before step 1 — a
// rejected value then sat in the box looking live while every resolver ignored
// it. Refusing the write leaves the last good value in place, and the reload
// shows the host that their keystroke did not take.

import type { PowerupTypeOverride } from '$lib/types';

/** The four generic earn knobs, the whole scope of the clear-semantics step. */
export const EARN_FIELDS = ['chance', 'weight', 'min_score_pct', 'max_score_pct'] as const;
export type EarnField = (typeof EARN_FIELDS)[number];

export type OverridePatch = {
	/** Keys to write. */
	set: PowerupTypeOverride;
	/** Keys to remove, so the resolver's default applies again. */
	clear: EarnField[];
};

/** How a field arrived. `null` is absent; anything else is present. */
export type FieldReader = (name: string) => string | null;

type FieldRule = {
	/** Parse the raw string into what gets stored, or null to refuse it. */
	parse: (raw: string) => number | null;
};

/**
 * One rule per earn field. Each mirrors the bound its resolver enforces, so a
 * value this accepts is a value the runtime will honour — the point being that
 * the console cannot store something it will then display as 'invalid'.
 *
 * `chance` is the one with a unit change: the box is a percentage because that
 * is how a host thinks about a drop rate, the column is a 0–1 fraction because
 * that is what `rand() < chance` needs. Same conversion the action has always
 * done (`pct / 100`), moved rather than rewritten.
 */
const RULES: Record<EarnField, FieldRule> = {
	chance: {
		parse: (raw) => {
			const pct = Number(raw);
			if (!Number.isInteger(pct) || pct < 0 || pct > 100) return null;
			return pct / 100;
		}
	},
	weight: {
		// 0 is meaningful (never drawn, others keep their ratio), negative is not:
		// resolveTypeWeight refuses it because it would corrupt weightedPick's
		// cumulative sum. Non-integers are fine — a weight is a ratio.
		parse: (raw) => {
			const n = Number(raw);
			if (!Number.isFinite(n) || n < 0) return null;
			return n;
		}
	},
	min_score_pct: { parse: parsePercent },
	max_score_pct: { parse: parsePercent }
};

function parsePercent(raw: string): number | null {
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0 || n > 100) return null;
	return n;
}

/**
 * Read the four earn fields off a request and say what to write and what to
 * remove. Pure: it takes a reader rather than a FormData so a test can drive it
 * with a plain map.
 *
 * An empty string is the ONLY thing that clears. A whitespace-only value is
 * trimmed to empty and clears too, because that is what the host typed into an
 * otherwise blank box.
 */
export function parseEarnFields(read: FieldReader): OverridePatch {
	const set: PowerupTypeOverride = {};
	const clear: EarnField[] = [];

	for (const field of EARN_FIELDS) {
		const raw = read(field);
		if (raw === null) continue; // absent — this form does not own the field
		const trimmed = raw.trim();
		if (trimmed === '') {
			clear.push(field);
			continue;
		}
		const value = RULES[field].parse(trimmed);
		if (value === null) continue; // refused — keep whatever is stored
		set[field] = value;
	}

	return { set, clear };
}

/**
 * The next value of `types[typeId]`: the stored override with `clear` removed
 * and `set` applied.
 *
 * Returned WHOLE rather than as a diff, because that is what the merge helper
 * consumes — mergePowerupConfig replaces `types[typeId]` with whatever it is
 * given (merging only one level, by type id), so a key left out here is a key
 * gone from the config. That is precisely the mechanism the clear rides on, and
 * the reason clearing needs no new helper and no change to the write boundary
 * that verify-config-merge-safe guards.
 *
 * Clears are applied BEFORE sets so the two can never fight: a field is only
 * ever in one of the two lists, and this ordering makes that invariant harmless
 * even if it were violated.
 */
export function applyOverridePatch(
	current: PowerupTypeOverride | undefined,
	patch: OverridePatch
): PowerupTypeOverride {
	const next: PowerupTypeOverride = { ...(current ?? {}) };
	for (const field of patch.clear) delete next[field];
	Object.assign(next, patch.set);
	return next;
}
