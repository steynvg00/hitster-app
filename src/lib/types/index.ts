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

export type ClipType = 'snippet' | 'fragment' | 'kick' | 'vocal' | 'mashup';

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
	type: ClipType;
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
	tempo?: { enabled: boolean; rate: number }; // 0.25 to 4.0
	lowpass?: { enabled: boolean; cutoff_hz: number; q: number }; // 20 to 20000
	highpass?: { enabled: boolean; cutoff_hz: number; q: number }; // 20 to 20000
	bandpass?: { enabled: boolean; freq_hz: number; q: number; mod_rate_hz: number };
	phaser?: {
		enabled: boolean;
		rate_hz: number;
		depth: number;
		stages: number;
		feedback: number;
		stereo_offset_deg: number;
	};
	flanger?: { enabled: boolean; rate_hz: number; depth: number; feedback: number };
	bitcrusher?: { enabled: boolean; bits: number; sample_rate_reduction: number };
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
	tabs: TabFieldResult[]; // per-tab breakdown (new)
	tracks: TrackFieldResult[]; // legacy flat list for simple result display
	status: SubmissionStatus;
	submissionId: string;
	isFinal: boolean;
	breakdown?: ScoreBreakdown;
}

// ─── NFC ─────────────────────────────────────────────────────────────────────

export type NfcTagPurpose = 'team_identity' | 'team_entry' | 'challenge' | 'hint' | 'challenge_unlock';

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

export type PowerupCategory = 'offensive' | 'defensive' | 'information' | 'social' | 'self';
export type PowerupVisibility = 'public' | 'target_only' | 'hidden' | 'silent';
export type PowerupTargetType = 'self' | 'team' | 'all_others' | 'none';
export type PowerupMode = 'threshold' | 'token_shop';

export interface Powerup {
	id: string;
	slug: string;
	name: string;
	description: string;
	category: PowerupCategory;
	default_cost: number;
	default_visibility: PowerupVisibility;
	target_type: PowerupTargetType;
	effect_payload: Record<string, unknown>;
	sort_order: number;
}

export interface SetPowerup {
	id: string;
	set_id: string;
	powerup_id: string;
	enabled: boolean;
	cost_override: number | null;
	visibility_override: PowerupVisibility | null;
	effect_payload_override: Record<string, unknown>;
}

export interface PowerupConfig extends Powerup {
	set_powerup_id: string | null;
	effective_enabled: boolean;
	effective_cost: number;
	effective_visibility: PowerupVisibility;
	has_override: boolean;
}

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
// src/lib/server/powerups.ts. Piece 1 of the powerup-earning rebuild: this type
// + parseConfig/mergePowerupConfig are the only pieces built so far — the
// runtime (maybeAwardPowerup) still reads the legacy `earn_threshold` key until
// piece 3, and the console's powerup LIST is still legacy until piece 2.

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
}

export interface PowerupConfigV2 {
	version: 2;
	threshold_mode: ThresholdMode;
	band_mode: BandMode;
	thresholds_percent: number[];
	types: Record<string, PowerupTypeOverride>;
	categories: Record<string, boolean>;
}
