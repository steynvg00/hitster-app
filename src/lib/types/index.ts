// ─── Teams ───────────────────────────────────────────────────────────────────

export type TeamColor = 'blue' | 'yellow' | 'green' | 'red' | 'indigo' | 'black';

export interface Team {
	id: string;
	color: TeamColor;
	label: string; // static stage label, e.g. "Red: Mainstage"
	display_name: string; // host-editable, defaults to label
	score: number;
}

// ─── Tracks & Clips ──────────────────────────────────────────────────────────

export interface Track {
	id: string;
	artist: string;
	title: string;
	year: number;
	record_label?: string;
	festival?: string;
	vocal_source?: string;
}

export interface Clip {
	id: string;
	track_id: string;
	storage_path: string;
	position?: number;
}

// ─── Challenge types ──────────────────────────────────────────────────────────

export type ChallengeType = 'standard' | 'anthem' | 'label' | 'mashup' | 'fragments' | 'effects';

export interface Challenge {
	id: string;
	variant: ChallengeType;
	title: string;
	nfc_tag_id?: string;
	timer_seconds: number;
	is_active: boolean;
}

// ─── Effects chain config (stored as challenge_tabs.effects JSONB) ───────────

export interface EffectsConfig {
	pitch?: { enabled: boolean; semitones: number; window_size: number }; // semitones: -24 to +24
	tempo?: { enabled: boolean; rate: number }; // see TEMPO_RATE_MIN/MAX in $lib/audio-limits (0.85–1.2); older rows may hold wider values and are clamped at apply time
	lowpass?: { enabled: boolean; cutoff_hz: number; q: number }; // 20 to 20000
	highpass?: { enabled: boolean; cutoff_hz: number; q: number }; // 20 to 20000
	bandpass?: { enabled: boolean; freq_hz: number; q: number; mod_rate_hz: number };
	phaser?: {
		enabled: boolean;
		rate_hz: number;
		depth: number;
		stages: number;
		feedback: number;
	};
	flanger?: { enabled: boolean; rate_hz: number; depth: number; feedback: number };
	bitcrusher?: { enabled: boolean; bits: number };
	ring_mod?: { enabled: boolean; freq_hz: number; depth: number };
	delay?: { enabled: boolean; time_ms: number; feedback: number; wet: number };
	reverb?: { enabled: boolean; decay_s: number; pre_delay_ms: number; wet: number };
	reverse?: { enabled: boolean };
}

export interface EffectPreset {
	id: string;
	name: string;
	effects: EffectsConfig;
	is_builtin: boolean;
	created_by: string | null;
	created_at: string;
}

// ─── Mashup library ──────────────────────────────────────────────────────────

export interface Mashup {
	id: string;
	name: string;
	primary_clip_id: string;
	created_at: string;
}

export interface MashupSource {
	id: string;
	mashup_id: string;
	track_id: string;
	sort_order: number;
}

// ─── Challenge tabs (replaces challenge_tracks) ───────────────────────────────

export interface ChallengeTab {
	id: string;
	challenge_id: string;
	position: number;
	created_at: string;
	effects: EffectsConfig | null; // effects variant only
	mashup_id: string | null; // mashup variant only
}

export interface ChallengeTabSourceTrack {
	id: string;
	tab_id: string;
	track_id: string;
	sort_order: number;
}

export interface ChallengeTabClip {
	id: string;
	tab_id: string;
	clip_id: string;
	fragment_number: number | null; // null = non-fragment; 1,2,3... = numbered fragment
	sort_order: number;
}

// ─── Answer options (host-curated dropdowns) ─────────────────────────────────

export type AnswerField =
	| 'artist'
	| 'title'
	| 'year'
	| 'label'
	| 'festival'
	| 'vocal_source'
	| 'grouping';

export type InputMode = 'multiple_choice' | 'combobox' | 'open_text' | 'typeable_number' | 'slider';

export interface AnswerOption {
	id: string;
	challenge_id: string;
	field: AnswerField;
	value: string;
	input_mode: InputMode;
}

// ─── Answer pools (global shared combobox data) ──────────────────────────────

export interface AnswerPoolEntry {
	id: string;
	name: string;
	created_at: string;
}

// ─── Variant defaults (tier-1 point values) ──────────────────────────────────

export interface VariantDefault {
	variant: string;
	points_config: {
		field_points?: Partial<Record<AnswerField, number>>;
	};
}

// ─── Submissions & Scoring ───────────────────────────────────────────────────

export type SubmissionStatus =
	| 'auto_correct'
	| 'auto_wrong'
	| 'review_requested'
	| 'review_approved'
	| 'review_rejected';

export interface ScoreBreakdown {
	base: number;
	difficulty_multiplier: number;
	round_multiplier: number;
	comeback_multiplier: number;
	streak_bonus: number;
	speed_bonus: number;
	final: number;
	bonus_powerup?: number;
	powerup_multipliers?: number[];
	// double_down: the resolved bet. Persisted so the result screen can explain WHY
	// the points moved — the multiplier alone is indistinguishable from any other
	// entry in powerup_multipliers. Present only when a Double Down was active.
	double_down?: {
		predicted_pct: number; // what the team predicted, 0–100
		score_pct: number; // what it actually scored (bonus-excluded threshold %)
		hit: boolean; // score_pct >= predicted_pct
		multiplier: number; // the factor that entered the additive-delta sum
	};
}

// Per-slot answer within a tab (new multi-source shape)
export interface SourceAnswer {
	slot_index: number;
	matched_source_track_id?: string; // set by scorer during scoring
	field_values: Record<string, string | number>;
	fragments?: number[]; // fragments type only — which fragment numbers the player assigned
	scored: Record<string, number>;
	total: number;
}

// Per-tab answer entry in submissions.answers (new shape post-migration-0036)
export interface TabAnswer {
	tab_position: number;
	source_answers: SourceAnswer[];
	breakdown?: ScoreBreakdown; // only on answers[0]
}

// Legacy shape (pre-0036) — kept for graceful read fallback
export interface AnswerArrayEntry {
	track_id: string | null;
	field_values: Record<string, string>;
	scored: Record<string, number>;
	total: number;
	breakdown?: ScoreBreakdown;
}

export interface Submission {
	id: string;
	challenge_id: string;
	team_id: string;
	answers: TabAnswer[];
	score?: number;
	status: SubmissionStatus;
	is_final: boolean;
	submitted_at: string;
}

export interface ReviewRequest {
	id: string;
	submission_id: string;
	field_name: string;
	track_id?: string | null;
	player_message?: string | null;
	created_at: string;
	resolved: boolean;
}

// ─── Per-field scoring result ─────────────────────────────────────────────────

export interface FieldResult {
	field: AnswerField;
	submitted: string;
	correct: string;
	score: number;
	maxScore: number;
	fuzzyScore?: number;
	// Bonus fields add to the team's score but are excluded from powerup-threshold
	// math. Optional so pre-configurable-fields results and rebuilds are unaffected.
	isBonus?: boolean;
	// PARTIAL bonus within an otherwise-threshold field (C1 stuk 1: bonus artists
	// inside the artist field). `score`/`maxScore` are the totals; these carry the
	// portion of each that is bonus, so the threshold split can subtract it.
	// Absent on every other field, where the whole field is threshold-or-bonus via
	// isBonus alone — so pre-C1 results are unaffected.
	bonusScore?: number;
	bonusMax?: number;
	// The bonus artists actually MATCHED, named, with the points each contributed
	// (C1 stuk 2) — bonusScore is only their total, which can't say who scored it.
	// Absent when none matched, so the results screen renders no empty section.
	// Σ points === bonusScore; see ArtistScoreResult.bonusArtists in scoring.ts.
	bonusArtists?: { name: string; points: number }[];
}

// Per-slot scoring result (one slot = one source track assignment)
export interface SlotFieldResult {
	slotIndex: number;
	matchedTrackId: string | null;
	fields: FieldResult[];
	total: number;
	maxTotal: number;
}

// Per-tab scoring result (replaces TrackFieldResult)
export interface TabFieldResult {
	tabPosition: number;
	tabIndex: number; // 1-based display number
	slots: SlotFieldResult[];
	total: number;
	maxTotal: number;
}

// Legacy alias kept for backward compat with existing result-screen references
export interface TrackFieldResult {
	trackId: string;
	trackIndex: number;
	fields: FieldResult[];
	total: number;
	maxTotal: number;
}

// Challenge result returned by submit action + stored as priorResult in load()
export interface ChallengeResult {
	total: number;
	maxTotal: number;
	// Bonus-excluded pair — the denominator/numerator for all powerup-threshold
	// math. Equal to total/maxTotal when the challenge has no bonus fields.
	thresholdTotal?: number;
	thresholdMax?: number;
	tabs: TabFieldResult[]; // per-tab breakdown (new)
	tracks: TrackFieldResult[]; // legacy flat list for simple result display
	status: SubmissionStatus;
	submissionId: string;
	isFinal: boolean;
	breakdown?: ScoreBreakdown;
}

// ─── NFC ─────────────────────────────────────────────────────────────────────

export type NfcTagPurpose =
	| 'team_identity'
	| 'team_entry'
	| 'challenge'
	| 'hint'
	| 'challenge_unlock';

export interface NfcTag {
	id: string;
	purpose: NfcTagPurpose;
	team_color?: TeamColor;
	challenge_id?: string;
	set_id?: string;
}

// ─── Game Sets ────────────────────────────────────────────────────────────────

export type GameSetStatus = 'active' | 'inactive';

export interface GameSet {
	id: string;
	name: string;
	description: string | null;
	team_count: number;
	total_timer_seconds: number | null;
	expected_player_count: number | null;
	assignment_slots: string[];
	assignment_index: number;
	status: GameSetStatus;
	recap_state: string;
	recap_ranking: string[];
	recap_reveal_index: number;
	battle_reveal_index: number;
	started_at: string | null;
	ended_at: string | null;
	created_at: string;
}

export interface SetChallenge {
	id: string;
	set_id: string;
	challenge_id: string;
	position: number;
}

// ─── Powerups ─────────────────────────────────────────────────────────────────

export type PowerupCategory =
	| 'offensive'
	| 'defensive'
	| 'information'
	| 'social'
	| 'self'
	| 'punishment'
	| 'wildcard';
export type PowerupMode = 'threshold' | 'token_shop';

export interface ThresholdConfig {
	thresholds_percent: number[];
}

export interface TokenShopConfig {
	starting_tokens: number;
	per_correct_challenge: number;
	streak_bonuses: Array<{ streak: number; bonus: number }>;
	time_tick_minutes: number | null;
	tokens_per_tick: number;
}

export type SetPowerupConfig = ThresholdConfig | TokenShopConfig;

// ─── Powerup config v2 (per-set earning rules) ───────────────────────────────
// Normalized shape for game_sets.powerup_config, produced by parseConfig() in
// src/lib/server/powerups.ts. Consumed by the admin console (piece 2) and the
// earning runtime awardPowerups (piece 3a). Piece 3b (auto-submit backstop) and
// piece 4 (penalty_shot activation) remain.

// 'per_challenge': score % is this submission's score / this challenge's max.
// 'cumulative': score % is total team score / total possible across the set so far.
export type ThresholdMode = 'per_challenge' | 'cumulative';

// 'all_bands': every threshold crossed in one submission awards a powerup.
// 'highest_band': only the single highest newly-crossed threshold awards.
export type BandMode = 'all_bands' | 'highest_band';

export interface PowerupTypeOverride {
	enabled?: boolean;
	threshold?: number;
	chance?: number;
	inverse?: boolean;
	// lucky_dice only: the inclusive range the roll is drawn from. Kept here, in
	// the per-type override map, rather than as a constant in the activation
	// branch — a later settings UI edits it the same way it edits `threshold` or
	// `chance`, and resolveDiceRange() (src/lib/server/powerups.ts) supplies the
	// 1–6 default whenever these are absent or invalid.
	dice_min?: number;
	dice_max?: number;
	// x_ray only: how many reveals one activation is worth. Same story as the dice
	// range — a setting rather than a constant, with resolveXrayBudget()
	// (src/lib/server/powerups.ts) supplying X_RAY_DEFAULT_BUDGET when absent.
	reveal_budget?: number;
	// all_seeing_eye only: whether the panel also shows each finished team's total
	// score beside their answers. Defaults to FALSE because a score is a
	// correctness signal — "45 of 45" says all three answers are right, which is
	// precisely what the Eye is built not to tell you. Resolved by
	// resolveEyeShowScores() (src/lib/server/powerups.ts), which treats anything
	// that is not exactly `true` as false.
	show_scores?: boolean;
	// power_spin only: how often the wheel reaches for Tier S instead of Tier A,
	// as a probability in [0,1]. Third instance of the same pattern as the dice
	// range and the reveal budget — a per-set dial, resolved by
	// resolveSpinTierSChance() (src/lib/server/powerups.ts) with
	// POWER_SPIN_DEFAULT_TIER_S_CHANCE as the fallback. Seeded at 0.15 by
	// migration 0072, i.e. the designed 85% A / 15% S split.
	tier_s_chance?: number;
}

export interface PowerupConfigV2 {
	version: 2;
	threshold_mode: ThresholdMode;
	band_mode: BandMode;
	thresholds_percent: number[];
	types: Record<string, PowerupTypeOverride>;
	categories: Record<string, boolean>;
	// Lazy cache (piece 3a) of the set's total base max score, used only by
	// cumulative threshold_mode to compute teamScore/setMax. Computed once on
	// first cumulative earning and stored back in powerup_config. NOT invalidated
	// when the set's challenge list changes — acceptable staleness for a party game.
	computed_set_max?: number;
}

// ─── Console powerup list (piece 2) ──────────────────────────────────────────
// One row per powerup_types entry, merged with its per-set override from
// powerup_config.types[id] (via parseConfig). Replaces the legacy PowerupConfig
// (powerups + set_powerups) as the console's data source.
export interface PowerupTypeConsoleRow {
	id: string;
	name: string;
	category: PowerupCategory;
	description: string | null;
	icon: string | null;
	enabled_by_default: boolean;
	coming_soon: boolean;
	default_min_score_pct: number;
	default_max_score_pct: number;
	// Piece 4: whether this type earns via the inverse channel (score BELOW a
	// bound) rather than the normal ladder (score AT/ABOVE a bound). A fixed
	// trait of the type (powerup_types.default_inverse) — the console has no
	// per-set override for it, only for enabled/threshold/chance. Drives the
	// Threshold field's label/placeholder ("earn below" vs "earn at/above").
	is_inverse: boolean;
	effective_enabled: boolean;
	// null = no override; UI shows default_min_score_pct (or default_max_score_pct
	// for an inverse type) as a placeholder
	effective_threshold: number | null;
	effective_chance: number; // 0–1, defaults to 1.0
	has_override: boolean;
}
