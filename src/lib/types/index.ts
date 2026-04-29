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
	festival?: string;       // for Anthem variant
	vocal_source?: string;   // movie/show for Vocal variant
}

export interface Clip {
	id: string;
	track_id: string;
	type: ClipType;
	storage_path: string;    // Supabase Storage path
	position?: number;       // for fragment ordering
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
	nfc_tag_id?: string;     // NFC sticker linked to this challenge
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

// ─── Submissions & Scoring ───────────────────────────────────────────────────

export type SubmissionStatus =
	| 'auto_correct'
	| 'auto_wrong'
	| 'review_requested'
	| 'review_approved'
	| 'review_rejected';

export interface Submission {
	id: string;
	challenge_id: string;
	team_id: string;
	answers: Record<AnswerField, string>;
	score?: number;
	status: SubmissionStatus;
	submitted_at: string;
}

export interface ReviewRequest {
	id: string;
	submission_id: string;
	field_name: string;
	player_message?: string | null;
	created_at: string;
	resolved: boolean;
}

// Unified per-field scoring result (used in challenge form response + priorResult)
export interface FieldResult {
	field: AnswerField;
	submitted: string;
	correct: string;
	score: number;
	maxScore: number;
	fuzzyScore?: number; // 0–1 similarity for open_text fields
}

export interface ChallengeResult {
	total: number;
	maxTotal: number;
	fields: FieldResult[];
	status: SubmissionStatus;
	submissionId: string;
}

// ─── NFC ─────────────────────────────────────────────────────────────────────

export type NfcTagPurpose = 'team_identity' | 'team_entry' | 'challenge';

export interface NfcTag {
	id: string;             // the physical tag UID
	purpose: NfcTagPurpose;
	team_color?: TeamColor; // set for team_identity tags
	challenge_id?: string;  // set for challenge tags
}
