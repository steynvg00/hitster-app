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

// ─── Challenges ──────────────────────────────────────────────────────────────

export type ChallengeVariant =
	| 'normal'
	| 'label'
	| 'anthem'
	| 'vocal'
	| 'fragments'
	| 'kick'
	| 'mashup'
	| 'battle';

export interface Challenge {
	id: string;
	variant: ChallengeVariant;
	title: string;
	nfc_tag_id?: string;
	timer_seconds: number;
	is_active: boolean;
}

export interface ChallengeTrack {
	id: string;
	challenge_id: string;
	track_id: string;
	clip_id: string;
	sort_order: number;
}

// ─── Answer options (host-curated dropdowns) ─────────────────────────────────

export type AnswerField = 'artist' | 'title' | 'year' | 'label' | 'festival' | 'vocal_source';

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

// One element of submissions.answers JSONB array (new multi-track format)
export interface AnswerArrayEntry {
	track_id: string | null;
	field_values: Record<string, string>;
	scored: Record<string, number>;
	total: number;
}

export interface Submission {
	id: string;
	challenge_id: string;
	team_id: string;
	answers: AnswerArrayEntry[];
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
	fuzzyScore?: number; // 0–1 similarity for open_text fields
}

// ─── Per-track scoring result (new multi-track shape) ────────────────────────

export interface TrackFieldResult {
	trackId: string;
	trackIndex: number; // 1-based display number
	fields: FieldResult[];
	total: number;
	maxTotal: number;
}

// Challenge result returned by submit action + stored as priorResult in load()
export interface ChallengeResult {
	total: number;
	maxTotal: number;
	tracks: TrackFieldResult[]; // one entry per challenge_track
	status: SubmissionStatus;
	submissionId: string;
	isFinal: boolean;
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
