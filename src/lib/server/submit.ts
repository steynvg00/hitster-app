import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { ChallengeResult, SubmissionStatus } from '$lib/types/index.js';
import {
	resolveChallengeFields,
	resolveTabFields,
	fieldMapsFromResolved,
	resolveArtistBonus,
	scoreSubmission,
	getSourceTracksForTab,
	type TrackData,
	type BonusParams,
	type TabInput,
	type SlotDraft,
	type TabClipData,
	type TabSourceTrackRaw,
	type MashupSourceRaw,
	type ClipRaw
} from '$lib/server/scoring.js';
import {
	awardPowerups,
	loadActiveEffects,
	deriveEffectModifiers,
	consumeEffects,
	type EarnedPowerup
} from '$lib/server/powerups';
import { maybeTransferCrown } from '$lib/server/crown';
import { maybeResolveBattle } from '$lib/server/battle';

type AdminClient = SupabaseClient<Database>;

export type ScoreAndPersistInput = {
	// Pre-loaded challenge row (both callers already fetch it for their own guards).
	challenge: {
		id: string;
		variant: string;
		points_config: unknown;
		difficulty_rating?: number;
		speed_threshold_seconds?: number | null;
	};
	// Pre-loaded challenge_tabs rows. `fields` (C3b, migration 0068) is the per-tab
	// fields override; NULL/absent → inherit challenge-wide. Both callers select('*').
	tabs: Array<{ id: string; position: number; mashup_id?: string | null; fields?: unknown }>;
	teamId: string;
	playerSetId: string | null;
	// New multi-track shape: Record<tabPosition, SlotDraft[]>. Pass {} for an
	// empty submission (auto-submit backstop) — every field then scores 0.
	draftByTab: Record<string, SlotDraft[]>;
	elapsedSeconds: number | null;
	// DEV one-shot powerup force (interactive path passes the cookie value).
	forcePowerupTypeId?: string;
};

export type ScoreAndPersistResult =
	| {
			ok: true;
			submissionId: string;
			scoredResult: Omit<ChallengeResult, 'submissionId' | 'isFinal'> & { status: SubmissionStatus };
			earnedPowerups: EarnedPowerup[];
	  }
	| { ok: false; error: string; code?: string };

/**
 * The shared scoring + persistence pipeline for a single team's challenge
 * submission. Extracted from the interactive submit action so the auto-submit
 * backstop can run the SAME pipeline on an empty draft instead of hand-crafting
 * an empty score-0 row that skipped scoring, the insurance floor, streak reset,
 * effect consumption, crown transfer, and powerup earning.
 *
 * In order, exactly as the interactive action did it:
 *   resolve challenge_multiplier → load source tracks/clips/mashups/tracks →
 *   resolve fieldModes/fieldPoints (three-tier) → load team + leader + active
 *   effects → build BonusParams → scoreSubmission (applies the insurance floor)
 *   → insert the is_final submission → update status/end attempt/team score +
 *   streak → maybeTransferCrown → consumeEffects → awardPowerups.
 *
 * Uses the admin client throughout: the interactive path previously inserted via
 * the public client, but the submissions INSERT policy is `with check (true)`
 * (no team-identity enforcement), so the admin insert is observably identical —
 * same row, same columns, same unique-constraint 409 on a duplicate.
 */
export async function scoreAndPersistSubmission(
	admin: AdminClient,
	input: ScoreAndPersistInput
): Promise<ScoreAndPersistResult> {
	const { challenge, tabs, teamId, playerSetId, draftByTab, elapsedSeconds } = input;
	const challengeId = challenge.id;
	const variant = challenge.variant;
	const tabIds = tabs.map((t) => t.id);

	// Round multiplier from the set (if the team is playing inside a set).
	let challengeMultiplier = 1;
	if (playerSetId) {
		const { data: sc } = await admin
			.from('set_challenges')
			.select('challenge_multiplier')
			.eq('challenge_id', challengeId)
			.eq('set_id', playerSetId)
			.maybeSingle();
		challengeMultiplier = (sc as { challenge_multiplier?: number } | null)?.challenge_multiplier ?? 1;
	}

	const [sourceTracksResult, tabClipsResult] = await Promise.all([
		admin.from('challenge_tab_source_tracks').select('*').in('tab_id', tabIds).order('sort_order'),
		admin.from('challenge_tab_clips').select('*').in('tab_id', tabIds).order('sort_order')
	]);
	const sourceTracks = sourceTracksResult.data ?? [];
	const tabClipRows = tabClipsResult.data ?? [];

	// For mashup: load mashup sources
	const mashupIds =
		variant === 'mashup'
			? [...new Set(tabs.map((t) => t.mashup_id).filter((id): id is string => !!id))]
			: [];
	const { data: mashupSourceRows } = mashupIds.length
		? await admin.from('mashup_sources').select('*').in('mashup_id', mashupIds).order('sort_order')
		: { data: [] };
	const mashupSources: MashupSourceRaw[] = (mashupSourceRows ?? []).map((r) => ({
		id: r.id,
		mashup_id: r.mashup_id,
		track_id: r.track_id,
		sort_order: r.sort_order
	}));

	const clipIds = [...new Set(tabClipRows.map((c) => c.clip_id))];

	// Fetch clips first — fragments derives source tracks from clip.track_id
	const clipsResult = await (clipIds.length
		? admin.from('clips').select('id, track_id').in('id', clipIds)
		: Promise.resolve({ data: [] as { id: string; track_id: string }[] }));
	const clips: ClipRaw[] = (clipsResult.data ?? []).map((c) => ({ id: c.id, track_id: c.track_id }));

	const trackIds = [
		...new Set([
			...sourceTracks.map((s) => s.track_id),
			...mashupSources.map((s) => s.track_id),
			...clips.map((c) => c.track_id).filter(Boolean)
		])
	];

	const tracksResult = await (trackIds.length
		? admin.from('tracks').select('*').in('id', trackIds)
		: Promise.resolve({ data: [] as { id: string; [key: string]: unknown }[] }));
	const trackMap = new Map((tracksResult.data ?? []).map((t) => [t.id, t as TrackData]));
	const allTabClipData: TabClipData[] = tabClipRows.map((c) => ({
		id: c.id,
		tabId: c.tab_id,
		clipId: c.clip_id,
		fragmentNumber: c.fragment_number,
		sortOrder: c.sort_order,
		trackId: clips.find((cl) => cl.id === c.clip_id)?.track_id
	}));

	const pcRaw = (challenge.points_config ?? {}) as Record<string, unknown>;

	// Battle mode (additive): a battle challenge scores + awards EXACTLY like a
	// normal one here (nothing below is deferred or skipped). The only battle-
	// specific work at submit is recording the ranking key (base+bonus, written
	// into the submission insert below); the rank-based ladder bonus is added
	// later by resolveBattle. Detecting it here keeps the whole feature to a
	// couple of guarded lines in this shared pipeline.
	const isBattle = ((pcRaw.battle ?? {}) as { enabled?: boolean }).enabled === true;

	const { data: vdRow } = await admin
		.from('variant_defaults')
		.select('points_config, streak_config')
		.eq('variant', variant)
		.maybeSingle();
	const variantDefaultPoints = ((vdRow?.points_config as Record<string, unknown> | null)
		?.field_points ?? {}) as Record<string, number>;
	const streakThresholds = ((vdRow?.streak_config as Record<string, unknown> | null)?.thresholds ??
		[]) as Array<{ streak: number; bonus: number }>;

	// Challenge-wide fields — the fallback for tabs without an override, and the
	// scoreSubmission base params. Per-tab resolution (C3b) is attached below via
	// resolveTabFields on each TabInput; with every tab NULL the two are identical.
	const resolvedFields = resolveChallengeFields(variant, pcRaw, variantDefaultPoints);
	const { fields: variantFields, fieldModes, fieldPoints, bonusFields } =
		fieldMapsFromResolved(resolvedFields);
	// Per-challenge bonus-artist marking (C1 stuk 1) stays challenge-wide. {} for
	// every challenge that hasn't set one, which is all of them until C1 stuk 2's
	// editor ships.
	const artistBonus = resolveArtistBonus(pcRaw);

	// ── Bonus params ──────────────────────────────────────────────────────
	const [teamRes, allTeamsRes] = await Promise.all([
		admin.from('teams').select('score, current_streak').eq('id', teamId).single(),
		admin.from('teams').select('score').order('score', { ascending: false }).limit(1)
	]);
	const teamRow = teamRes.data;
	const leaderScore = allTeamsRes.data?.[0]?.score ?? 0;

	// Load active powerup effects for this team and derive scoring modifiers
	let effectModifiers: ReturnType<typeof deriveEffectModifiers> = {
		extraMultipliers: [],
		insuranceActive: false,
		bonusPoints: 0,
		doubleDownPct: null,
		toConsume: []
	};
	if (playerSetId) {
		const activeEffects = await loadActiveEffects(admin, teamId, playerSetId);
		effectModifiers = deriveEffectModifiers(activeEffects);
	}

	const bonusParams: BonusParams = {
		difficulty_rating: challenge.difficulty_rating ?? 3,
		challenge_multiplier: challengeMultiplier,
		team_score: teamRow?.score ?? 0,
		leader_score: leaderScore,
		current_streak: teamRow?.current_streak ?? 0,
		streak_thresholds: streakThresholds,
		elapsed_seconds: elapsedSeconds,
		speed_threshold_seconds: challenge.speed_threshold_seconds ?? null,
		extraMultipliers: effectModifiers.extraMultipliers,
		insuranceActive: effectModifiers.insuranceActive,
		bonusPoints: effectModifiers.bonusPoints,
		// Not a multiplier — the prediction behind one. scoreSubmission resolves it
		// once it knows this submission's threshold percentage (see computeBreakdown).
		doubleDownPct: effectModifiers.doubleDownPct
	};

	// Build TabInput[] for scoreSubmission using getSourceTracksForTab
	const tabInputs: TabInput[] = tabs.map((tab) => {
		const tabSrcs = getSourceTracksForTab(
			variant,
			{ id: tab.id, mashup_id: tab.mashup_id },
			sourceTracks as TabSourceTrackRaw[],
			mashupSources,
			allTabClipData,
			clips,
			trackMap
		);
		const tabClipItems = allTabClipData.filter((c) => c.tabId === tab.id);
		const playerDraft: SlotDraft[] = draftByTab[String(tab.position)] ?? [{ fieldValues: {} }];
		// C3b: resolve THIS tab's fields (override or inherited-challenge-wide) and
		// attach as fieldMaps. NULL tab (all of them, this batch) → challenge-wide,
		// so scoring is bit-identical.
		const fieldMaps = fieldMapsFromResolved(
			resolveTabFields(
				{ fields: (tab as { fields?: unknown }).fields },
				{ variant, points_config: pcRaw },
				variantDefaultPoints
			)
		);
		return {
			tabId: tab.id,
			tabPosition: tab.position,
			sourceTracks: tabSrcs,
			clips: tabClipItems,
			playerDraft,
			fieldMaps
		};
	});

	const { answersArray, result: scoredResult } = scoreSubmission(
		tabInputs,
		variantFields,
		fieldModes,
		fieldPoints,
		bonusParams,
		bonusFields,
		artistBonus
	);

	const finalScore = scoredResult.breakdown?.final ?? scoredResult.total;

	const { data: sub, error: subErr } = await admin
		.from('submissions')
		.insert({
			challenge_id: challengeId,
			team_id: teamId,
			answers: answersArray as never,
			score: finalScore,
			is_final: true,
			// Ranking key for battle mode: base+bonus (scoredResult.total), PRE any
			// multiplier / insurance floor / speed / streak. Only set for a battle
			// challenge — a normal submission never references the column, so normal
			// play is decoupled from the 0061 migration.
			...(isBattle ? { battle_raw_score: scoredResult.total } : {})
		} as never)
		.select('id')
		.single();

	if (subErr) {
		return { ok: false, error: subErr.message, code: subErr.code };
	}
	if (!sub) return { ok: false, error: 'Submission insert returned no data' };

	const newStreak = scoredResult.total > 0 ? (teamRow?.current_streak ?? 0) + 1 : 0;

	await Promise.all([
		admin
			.from('submissions')
			.update({ status: scoredResult.status } as never)
			.eq('id', sub.id),
		admin
			.from('challenge_attempts')
			.update({ ended_at: new Date().toISOString() })
			.eq('challenge_id', challengeId)
			.eq('team_id', teamId),
		admin
			.from('teams')
			.update({ score: (teamRow?.score ?? 0) + finalScore, current_streak: newStreak })
			.eq('id', teamId)
	]);

	// Crown: check if this team overtook the current crown holder
	if (playerSetId) {
		const newTeamScore = (teamRow?.score ?? 0) + finalScore;
		await maybeTransferCrown(admin, playerSetId, teamId, newTeamScore);
	}

	// Consume single-use effects (insurance, single_event_mult, bonus_points)
	if (playerSetId && effectModifiers.toConsume.length > 0) {
		await consumeEffects(admin, effectModifiers.toConsume, challengeId);
	}

	// Powerup earning (v2): the ladder/inverse planner may award MULTIPLE
	// powerups from one submission (x crossed bands = up to x awards).
	let earnedPowerups: EarnedPowerup[] = [];
	if (playerSetId) {
		// Threshold %: bonus-excluded pair (falls back to total/maxTotal when the
		// challenge has no bonus fields, i.e. every existing challenge).
		const thresholdMax = scoredResult.thresholdMax ?? scoredResult.maxTotal ?? 0;
		const thresholdTotal = scoredResult.thresholdTotal ?? scoredResult.total;
		const scorePercent = thresholdMax > 0 ? (thresholdTotal / thresholdMax) * 100 : 0;
		earnedPowerups = await awardPowerups(
			admin,
			teamId,
			playerSetId,
			challengeId,
			scorePercent,
			input.forcePowerupTypeId
		);
	}

	// Battle resolution hook: this team's attempt was just ended above, so if it
	// was the last set-team to finish, resolve now (rank + ladder bonus + crown).
	// The timer→auto-submit→ended_at machinery drives this for the auto path too,
	// since the backstop also flows through here. Idempotent (CAS in resolveBattle)
	// and best-effort — a resolution hiccup must never fail the submit itself, and
	// the host "Resolve now" fallback (stuk 2) can always re-trigger it.
	if (isBattle && playerSetId) {
		try {
			await maybeResolveBattle(admin, playerSetId, challengeId);
		} catch {
			/* non-fatal: submit already succeeded; resolution can be re-triggered */
		}
	}

	return { ok: true, submissionId: sub.id, scoredResult, earnedPowerups };
}
