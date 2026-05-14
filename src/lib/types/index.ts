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

export type ChallengeType = 'standard' | 'anthem' | 'label' | 'mashup' | 'fragments';

export interface Challenge {
	id: string;
	variant: ChallengeType;
	title: string;
	nfc_tag_id?: string;
	timer_seconds: number;
	is_active: boolean;
}

// ─── Challenge tabs (replaces challenge_tracks) ───────────────────────────────

export interface ChallengeTab {
	id: string;
	challenge_id: string;
	position: number;
	created_at: string;
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

export type NfcTagPurpose = 'team_identity' | 'team_entry' | 'challenge' | 'randomizer';

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
