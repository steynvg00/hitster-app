// Auto-replaceable: run `npx supabase gen types typescript --project-id <id>`
// and paste the output here to keep this in sync with your live schema.
// Note: @supabase/supabase-js 2.60+ requires Relationships: [] on every table.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type TeamColor = 'blue' | 'yellow' | 'green' | 'red' | 'indigo' | 'black';
type ClipType = 'snippet' | 'fragment' | 'kick' | 'vocal' | 'mashup';
type ChallengeVariant = 'normal' | 'label' | 'anthem' | 'vocal' | 'fragments' | 'kick' | 'mashup' | 'battle';
type AnswerField = 'artist' | 'title' | 'year' | 'label' | 'festival' | 'vocal_source';
type NfcTagPurpose = 'team_identity' | 'team_entry' | 'challenge';
type SubmissionStatus = 'auto_correct' | 'auto_wrong' | 'review_requested' | 'review_approved' | 'review_rejected';

export type Database = {
	public: {
		Tables: {
			teams: {
				Row: {
					id: string;
					color: TeamColor;
					label: string;
					display_name: string;
					score: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					color: TeamColor;
					label: string;
					display_name?: string;
					score?: number;
					created_at?: string;
				};
				Update: {
					id?: string;
					color?: TeamColor;
					label?: string;
					display_name?: string;
					score?: number;
					created_at?: string;
				};
				Relationships: [];
			};
			players: {
				Row: {
					id: string;
					team_id: string;
					name: string;
					created_at: string;
				};
				Insert: {
					id?: string;
					team_id: string;
					name: string;
					created_at?: string;
				};
				Update: {
					id?: string;
					team_id?: string;
					name?: string;
					created_at?: string;
				};
				Relationships: [];
			};
			tracks: {
				Row: {
					id: string;
					artist: string;
					title: string;
					year: number;
					record_label: string | null;
					festival: string | null;
					vocal_source: string | null;
					genre: string | null;
					subgenre: string | null;
					accepted_titles: string[];
					created_at: string;
				};
				Insert: {
					id?: string;
					artist: string;
					title: string;
					year: number;
					record_label?: string | null;
					festival?: string | null;
					vocal_source?: string | null;
					genre?: string | null;
					subgenre?: string | null;
					accepted_titles?: string[];
					created_at?: string;
				};
				Update: {
					id?: string;
					artist?: string;
					title?: string;
					year?: number;
					record_label?: string | null;
					festival?: string | null;
					vocal_source?: string | null;
					genre?: string | null;
					subgenre?: string | null;
					accepted_titles?: string[];
					created_at?: string;
				};
				Relationships: [];
			};
			clips: {
				Row: {
					id: string;
					track_id: string;
					type: ClipType;
					storage_path: string;
					position: number | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					track_id: string;
					type: ClipType;
					storage_path: string;
					position?: number | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					track_id?: string;
					type?: ClipType;
					storage_path?: string;
					position?: number | null;
					created_at?: string;
				};
				Relationships: [];
			};
			challenges: {
				Row: {
					id: string;
					variant: ChallengeVariant;
					title: string;
					timer_seconds: number;
					is_active: boolean;
					stage_label: string | null;
					status: string;
					points_config: Json;
					created_at: string;
				};
				Insert: {
					id?: string;
					variant: ChallengeVariant;
					title: string;
					timer_seconds?: number;
					is_active?: boolean;
					stage_label?: string | null;
					status?: string;
					points_config?: Json;
					created_at?: string;
				};
				Update: {
					id?: string;
					variant?: ChallengeVariant;
					title?: string;
					timer_seconds?: number;
					is_active?: boolean;
					stage_label?: string | null;
					status?: string;
					points_config?: Json;
					created_at?: string;
				};
				Relationships: [];
			};
			challenge_attempts: {
				Row: {
					id: string;
					challenge_id: string;
					team_id: string;
					started_at: string;
					ended_at: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					team_id: string;
					started_at?: string;
					ended_at?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					team_id?: string;
					started_at?: string;
					ended_at?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			challenge_tracks: {
				Row: {
					id: string;
					challenge_id: string;
					track_id: string;
					clip_id: string;
					sort_order: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					track_id: string;
					clip_id: string;
					sort_order?: number;
					created_at?: string;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					track_id?: string;
					clip_id?: string;
					sort_order?: number;
					created_at?: string;
				};
				Relationships: [];
			};
			nfc_tags: {
				Row: {
					id: string;
					purpose: NfcTagPurpose;
					team_color: TeamColor | null;
					challenge_id: string | null;
					created_at: string;
				};
				Insert: {
					id: string;
					purpose: NfcTagPurpose;
					team_color?: TeamColor | null;
					challenge_id?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					purpose?: NfcTagPurpose;
					team_color?: TeamColor | null;
					challenge_id?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			answer_options: {
				Row: {
					id: string;
					challenge_id: string;
					field: AnswerField;
					value: string;
					input_mode: string;
					created_at: string;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					field: AnswerField;
					value: string;
					input_mode?: string;
					created_at?: string;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					field?: AnswerField;
					value?: string;
					input_mode?: string;
					created_at?: string;
				};
				Relationships: [];
			};
			submissions: {
				Row: {
					id: string;
					challenge_id: string;
					team_id: string;
					answers: Json;
					score: number | null;
					status: SubmissionStatus;
					is_final: boolean;
					submitted_at: string;
					created_at: string;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					team_id: string;
					answers?: Json;
					score?: number | null;
					status?: SubmissionStatus;
					is_final?: boolean;
					submitted_at?: string;
					created_at?: string;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					team_id?: string;
					answers?: Json;
					score?: number | null;
					status?: SubmissionStatus;
					is_final?: boolean;
					submitted_at?: string;
					created_at?: string;
				};
				Relationships: [];
			};
			review_requests: {
				Row: {
					id: string;
					submission_id: string;
					field_name: string;
					track_id: string | null;
					player_message: string | null;
					created_at: string;
					resolved: boolean;
				};
				Insert: {
					id?: string;
					submission_id: string;
					field_name: string;
					track_id?: string | null;
					player_message?: string | null;
					created_at?: string;
					resolved?: boolean;
				};
				Update: {
					id?: string;
					submission_id?: string;
					field_name?: string;
					track_id?: string | null;
					player_message?: string | null;
					created_at?: string;
					resolved?: boolean;
				};
				Relationships: [];
			};
			variant_defaults: {
				Row: {
					variant: string;
					points_config: Json;
				};
				Insert: {
					variant: string;
					points_config?: Json;
				};
				Update: {
					variant?: string;
					points_config?: Json;
				};
				Relationships: [];
			};
			answer_pool_artists: {
				Row: { id: string; name: string; created_at: string };
				Insert: { id?: string; name: string; created_at?: string };
				Update: { id?: string; name?: string; created_at?: string };
				Relationships: [];
			};
			answer_pool_labels: {
				Row: { id: string; name: string; created_at: string };
				Insert: { id?: string; name: string; created_at?: string };
				Update: { id?: string; name?: string; created_at?: string };
				Relationships: [];
			};
			answer_pool_festivals: {
				Row: { id: string; name: string; created_at: string };
				Insert: { id?: string; name: string; created_at?: string };
				Update: { id?: string; name?: string; created_at?: string };
				Relationships: [];
			};
			answer_pool_vocal_sources: {
				Row: { id: string; name: string; created_at: string };
				Insert: { id?: string; name: string; created_at?: string };
				Update: { id?: string; name?: string; created_at?: string };
				Relationships: [];
			};
			activity_log: {
				Row: {
					id: string;
					event_type: string;
					team_id: string | null;
					challenge_id: string | null;
					payload: Json | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					event_type: string;
					team_id?: string | null;
					challenge_id?: string | null;
					payload?: Json | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					event_type?: string;
					team_id?: string | null;
					challenge_id?: string | null;
					payload?: Json | null;
					created_at?: string;
				};
				Relationships: [];
			};
		};
		Views: { [_ in never]: never };
		Functions: { [_ in never]: never };
		Enums: { [_ in never]: never };
		CompositeTypes: { [_ in never]: never };
	};
};

// Convenience row types
export type TeamRow = Database['public']['Tables']['teams']['Row'];
export type TrackRow = Database['public']['Tables']['tracks']['Row'];
export type ClipRow = Database['public']['Tables']['clips']['Row'];
export type ChallengeRow = Database['public']['Tables']['challenges']['Row'];
export type ChallengeTrackRow = Database['public']['Tables']['challenge_tracks']['Row'];
export type AttemptRow = Database['public']['Tables']['challenge_attempts']['Row'];
export type AnswerOptionRow = Database['public']['Tables']['answer_options']['Row'];
export type SubmissionRow = Database['public']['Tables']['submissions']['Row'];
export type NfcTagRow = Database['public']['Tables']['nfc_tags']['Row'];
export type ActivityLogRow = Database['public']['Tables']['activity_log']['Row'];
export type ReviewRequestRow = Database['public']['Tables']['review_requests']['Row'];
export type VariantDefaultRow = Database['public']['Tables']['variant_defaults']['Row'];
export type AnswerPoolArtistRow = Database['public']['Tables']['answer_pool_artists']['Row'];
export type AnswerPoolLabelRow = Database['public']['Tables']['answer_pool_labels']['Row'];
export type AnswerPoolFestivalRow = Database['public']['Tables']['answer_pool_festivals']['Row'];
export type AnswerPoolVocalSourceRow = Database['public']['Tables']['answer_pool_vocal_sources']['Row'];
