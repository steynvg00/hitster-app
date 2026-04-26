// ─── Teams ───────────────────────────────────────────────────────────────────

export type TeamColor = 'blue' | 'yellow' | 'green' | 'red' | 'indigo' | 'black';

export interface Team {
	id: string;
	color: TeamColor;
	label: string; // e.g. "Red: Mainstage"
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

export interface AnswerOption {
	id: string;
	challenge_id: string;
	field: AnswerField;
	value: string;
}

// ─── Submissions & Scoring ───────────────────────────────────────────────────

export interface Submission {
	id: string;
	challenge_id: string;
	team_id: string;
	answers: Record<AnswerField, string>;
	score?: number;
	submitted_at: string;
}

// ─── NFC ─────────────────────────────────────────────────────────────────────

export type NfcTagPurpose = 'team_identity' | 'team_entry' | 'challenge';

export interface NfcTag {
	id: string;             // the physical tag UID
	purpose: NfcTagPurpose;
	team_color?: TeamColor; // set for team_identity tags
	challenge_id?: string;  // set for challenge tags
}
