// Console rows for the per-set powerup settings (admin/sets/[id]).
//
// THE RULE: this module RESOLVES, it does not decide. Every value it puts on a
// row comes back from the same function the earning runtime calls, so a host
// reading the console is reading the game rather than a second implementation of
// it that happens to agree today.
//
// ── What that rule replaced ─────────────────────────────────────────────────
// The rows used to be built inline in the page's load with a raw `??` chain:
//
//     effective_chance: override?.chance ?? 1
//
// which is not the resolution the runtime performs. resolveTypeChance falls back
// to the type's DESIGNED rate first (DEFAULT_TYPE_CHANCE) and only then to 1, and
// a set stores no `types` subtree until a host edits one — neither set-creation
// path writes it. So on every set made after migration 0071 the console showed
// Lifeline at 100% while awardPowerups rolled it at 50%. Same for the score
// range, which the row carried as "override or null" and therefore could not show
// at all, and for `weight` and the two safety-net modifiers, which never reached
// the client in any form.
//
// Splitting the build out of the load is what makes that pinnable: a bot can
// drive this function against the live catalogue and compare every field to its
// resolver (tests/bots/verify-console-row-resolved.ts). Nothing here writes.

import {
	parseConfig,
	resolveTypeChance,
	resolveTypeWeight,
	resolveMinScorePct,
	resolveMaxScorePct,
	resolveDiceRange,
	resolveXrayBudget,
	resolveEyeShowScores,
	resolveSpinTierSChance,
	resolveResurrectionScoreMode,
	isInverseChannel,
	type PowerupType
} from '$lib/server/powerups';
import type { PowerupConfigV2, PowerupTypeConsoleRow, ResolvedSetting } from '$lib/types';

/**
 * Pair a resolver's answer with the stored value that produced it.
 *
 * The `source` is decided by comparison rather than by re-running the resolver's
 * validation, which is the whole point: this module must not hold a second copy
 * of "what counts as a valid weight". If a value is stored and the resolver
 * handed it back, the override is live; if it is stored and the resolver handed
 * back something else, the resolver rejected it and the UI must say so.
 */
function setting<T>(raw: T | undefined, value: T, fallback: T): ResolvedSetting<T> {
	if (raw === undefined || raw === null) return { value, fallback, source: 'default' };
	return { value, fallback, source: value === raw ? 'override' : 'invalid' };
}

/**
 * The same config with every per-type override removed.
 *
 * Feeding this to a resolver answers "what would the runtime use if the host had
 * set nothing" — the placeholder each input shows, and the fallback half of every
 * ResolvedSetting. Built once and shared: no resolver reads anything else that
 * differs per type, so one bare config serves the whole catalogue.
 */
function bareConfig(cfg: PowerupConfigV2): PowerupConfigV2 {
	return { ...cfg, types: {} };
}

/**
 * One row per catalog type, with every setting resolved.
 *
 * `rawConfig` is the stored game_sets.powerup_config jsonb, unparsed — parsing is
 * done here so the caller cannot accidentally hand in a config that skipped
 * parseConfig's legacy upgrade.
 */
export function buildPowerupConsoleRows(
	rawConfig: unknown,
	types: PowerupType[]
): PowerupTypeConsoleRow[] {
	const cfg = parseConfig(rawConfig);
	const bare = bareConfig(cfg);

	// The five strength resolvers each read one hard-coded type id, so their
	// answers are config-wide rather than per-type: resolve them once here instead
	// of inside the loop. Which row they land on is decided by id below — the one
	// place that mapping lives now that the template no longer matches on ids.
	const dice = resolveDiceRange(cfg);
	const diceBare = resolveDiceRange(bare);
	const xray = resolveXrayBudget(cfg);
	const xrayBare = resolveXrayBudget(bare);
	const eye = resolveEyeShowScores(cfg);
	const eyeBare = resolveEyeShowScores(bare);
	const spin = resolveSpinTierSChance(cfg);
	const spinBare = resolveSpinTierSChance(bare);
	const resurrection = resolveResurrectionScoreMode(cfg);
	const resurrectionBare = resolveResurrectionScoreMode(bare);

	return types.map((type) => {
		const ov = cfg.types[type.id];
		const isInverse = isInverseChannel(cfg, type);

		return {
			id: type.id,
			name: type.name,
			category: type.category,
			description: type.description,
			icon: type.icon,
			enabled_by_default: type.enabled_by_default,
			coming_soon: type.coming_soon,
			tier: type.tier,
			holdable: type.holdable,
			immediate_use: type.immediate_use,
			is_inverse: isInverse,
			// No resolver to borrow: `enabled` is read inline by typeIsAvailable as
			// `override ?? enabled_by_default`, and this is the same expression rather
			// than a different one.
			effective_enabled: ov?.enabled ?? type.enabled_by_default,
			has_override: !!ov,

			chance: setting(
				ov?.chance,
				resolveTypeChance(cfg, type.id),
				resolveTypeChance(bare, type.id)
			),
			weight: setting(
				ov?.weight,
				resolveTypeWeight(cfg, type.id),
				resolveTypeWeight(bare, type.id)
			),
			min_score_pct: setting(
				ov?.min_score_pct,
				resolveMinScorePct(cfg, type),
				resolveMinScorePct(bare, type)
			),
			max_score_pct: setting(
				ov?.max_score_pct,
				resolveMaxScorePct(cfg, type),
				resolveMaxScorePct(bare, type)
			),

			dice_min: type.id === 'lucky_dice' ? setting(ov?.dice_min, dice.min, diceBare.min) : null,
			dice_max: type.id === 'lucky_dice' ? setting(ov?.dice_max, dice.max, diceBare.max) : null,
			reveal_budget: type.id === 'x_ray' ? setting(ov?.reveal_budget, xray, xrayBare) : null,
			show_scores: type.id === 'all_seeing_eye' ? setting(ov?.show_scores, eye, eyeBare) : null,
			tier_s_chance: type.id === 'power_spin' ? setting(ov?.tier_s_chance, spin, spinBare) : null,
			score_mode:
				type.id === 'resurrection' ? setting(ov?.score_mode, resurrection, resurrectionBare) : null,

			weight_modifier: ov?.weight_modifier ?? null,
			chance_modifier: ov?.chance_modifier ?? null,
			modifier_endpoint: isInverse ? 'chance' : 'weight'
		};
	});
}
