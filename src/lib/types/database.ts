// Auto-replaceable: run `npx supabase gen types typescript --project-id <id>`
// and paste the output here to keep this in sync with your live schema.
// Note: @supabase/supabase-js 2.60+ requires Relationships: [] on every table.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type TeamColor = 'blue' | 'yellow' | 'green' | 'red' | 'indigo' | 'black';
type PowerupCategory = 'offensive' | 'defensive' | 'information' | 'social' | 'self';
// Mirrors POWERUP_TIERS / PowerupTier in $lib/powerups-meta. Restated locally
// rather than imported because this file is regenerable (`supabase gen types`)
// and an import would be wiped by the next paste — the same reason every other
// alias above is local. The two are structurally identical, so assignment
// between them type-checks in both directions.
type PowerupTier = 'S' | 'A' | 'B' | 'C' | 'D';
type PowerupVisibility = 'public' | 'target_only' | 'hidden' | 'silent';
type PowerupTargetType = 'self' | 'team' | 'all_others' | 'none';
type ChallengeType = 'standard' | 'anthem' | 'label' | 'mashup' | 'fragments' | 'effects';
type AnswerField = 'artist' | 'title' | 'year' | 'label' | 'festival' | 'vocal_source' | 'grouping';
type NfcTagPurpose = 'team_identity' | 'team_entry' | 'challenge' | 'hint' | 'challenge_unlock';
type SubmissionStatus =
	| 'auto_correct'
	| 'auto_wrong'
	| 'review_requested'
	| 'review_approved'
	| 'review_rejected';

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
					current_streak: number;
					photo_url: string | null;
					token_balance: number;
					held_powerups: Json;
					last_threshold_crossed: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					color: TeamColor;
					label: string;
					display_name?: string;
					score?: number;
					current_streak?: number;
					photo_url?: string | null;
					token_balance?: number;
					held_powerups?: Json;
					last_threshold_crossed?: number;
					created_at?: string;
				};
				Update: {
					id?: string;
					color?: TeamColor;
					label?: string;
					display_name?: string;
					score?: number;
					current_streak?: number;
					photo_url?: string | null;
					token_balance?: number;
					held_powerups?: Json;
					last_threshold_crossed?: number;
					created_at?: string;
				};
				Relationships: [];
			};
			players: {
				Row: {
					id: string;
					team_id: string | null;
					set_id: string | null;
					name: string;
					display_name: string;
					photo_url: string | null;
					session_token: string | null;
					mode: 'team' | 'solo_group' | 'solo_private';
					session_expires_at: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					team_id?: string | null;
					set_id?: string | null;
					name: string;
					display_name: string;
					photo_url?: string | null;
					session_token?: string | null;
					mode?: 'team' | 'solo_group' | 'solo_private';
					session_expires_at?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					team_id?: string | null;
					set_id?: string | null;
					name?: string;
					display_name?: string;
					photo_url?: string | null;
					session_token?: string | null;
					mode?: 'team' | 'solo_group' | 'solo_private';
					session_expires_at?: string | null;
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
					artists: string[];
					created_by: string | null;
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
					artists?: string[];
					created_by?: string | null;
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
					artists?: string[];
					created_by?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			clips: {
				Row: {
					id: string;
					track_id: string;
					storage_path: string;
					position: number | null;
					duration: number | null;
					storage_object_path: string | null;
					effects: { pitch?: number; tempo?: number };
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					track_id: string;
					storage_path: string;
					position?: number | null;
					duration?: number | null;
					storage_object_path?: string | null;
					effects?: { pitch?: number; tempo?: number };
					created_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					track_id?: string;
					storage_path?: string;
					position?: number | null;
					duration?: number | null;
					storage_object_path?: string | null;
					effects?: { pitch?: number; tempo?: number };
					created_by?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			challenges: {
				Row: {
					id: string;
					variant: ChallengeType;
					title: string;
					timer_seconds: number | null;
					is_active: boolean;
					stage_label: string | null;
					status: string;
					points_config: Json;
					difficulty_rating: number;
					speed_threshold_seconds: number | null;
					hint_text: string | null;
					tutorial_text: string | null;
					nfc_lock_override: boolean | null;
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					variant: ChallengeType;
					title: string;
					timer_seconds?: number | null;
					is_active?: boolean;
					stage_label?: string | null;
					status?: string;
					points_config?: Json;
					difficulty_rating?: number;
					speed_threshold_seconds?: number | null;
					hint_text?: string | null;
					tutorial_text?: string | null;
					nfc_lock_override?: boolean | null;
					created_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					variant?: ChallengeType;
					title?: string;
					timer_seconds?: number | null;
					is_active?: boolean;
					stage_label?: string | null;
					status?: string;
					points_config?: Json;
					difficulty_rating?: number;
					speed_threshold_seconds?: number | null;
					hint_text?: string | null;
					tutorial_text?: string | null;
					nfc_lock_override?: boolean | null;
					created_by?: string | null;
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
					// This attempt's own clock, overriding challenges.timer_seconds
					// (migration 0074). NULL on every normal attempt; set to the 1/3
					// retry clock by a Resurrection.
					timer_override_seconds: number | null;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					team_id: string;
					started_at?: string;
					ended_at?: string | null;
					created_at?: string;
					timer_override_seconds?: number | null;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					team_id?: string;
					started_at?: string;
					ended_at?: string | null;
					created_at?: string;
					timer_override_seconds?: number | null;
				};
				Relationships: [];
			};
			challenge_tabs: {
				Row: {
					id: string;
					challenge_id: string;
					position: number;
					created_at: string;
					created_by: string | null;
					effects: Json | null;
					mashup_id: string | null;
					// C3b (migration 0068). NULL = inherit challenge-wide fields; a
					// non-empty array overrides fields for this tab only. Same row shape
					// as points_config.fields[]. Resolved via resolveTabFields.
					fields: Json | null;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					position?: number;
					created_at?: string;
					created_by?: string | null;
					effects?: Json | null;
					mashup_id?: string | null;
					fields?: Json | null;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					position?: number;
					created_at?: string;
					created_by?: string | null;
					effects?: Json | null;
					mashup_id?: string | null;
					fields?: Json | null;
				};
				Relationships: [];
			};
			mashups: {
				Row: {
					id: string;
					name: string;
					audio_storage_path: string;
					audio_duration_seconds: number | null;
					created_at: string;
					created_by: string | null;
				};
				Insert: {
					id?: string;
					name: string;
					audio_storage_path: string;
					audio_duration_seconds?: number | null;
					created_at?: string;
					created_by?: string | null;
				};
				Update: {
					id?: string;
					name?: string;
					audio_storage_path?: string;
					audio_duration_seconds?: number | null;
					created_at?: string;
					created_by?: string | null;
				};
				Relationships: [];
			};
			mashup_sources: {
				Row: {
					id: string;
					mashup_id: string;
					track_id: string;
					sort_order: number;
				};
				Insert: {
					id?: string;
					mashup_id: string;
					track_id: string;
					sort_order?: number;
				};
				Update: {
					id?: string;
					mashup_id?: string;
					track_id?: string;
					sort_order?: number;
				};
				Relationships: [];
			};
			challenge_tab_source_tracks: {
				Row: {
					id: string;
					tab_id: string;
					track_id: string;
					sort_order: number;
				};
				Insert: {
					id?: string;
					tab_id: string;
					track_id: string;
					sort_order?: number;
				};
				Update: {
					id?: string;
					tab_id?: string;
					track_id?: string;
					sort_order?: number;
				};
				Relationships: [];
			};
			challenge_tab_clips: {
				Row: {
					id: string;
					tab_id: string;
					clip_id: string;
					fragment_number: number | null;
					sort_order: number;
				};
				Insert: {
					id?: string;
					tab_id: string;
					clip_id: string;
					fragment_number?: number | null;
					sort_order?: number;
				};
				Update: {
					id?: string;
					tab_id?: string;
					clip_id?: string;
					fragment_number?: number | null;
					sort_order?: number;
				};
				Relationships: [];
			};
			nfc_tags: {
				Row: {
					id: string;
					slug: string;
					purpose: NfcTagPurpose;
					team_color: TeamColor | null;
					challenge_id: string | null;
					set_id: string | null;
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					slug: string;
					purpose: NfcTagPurpose;
					team_color?: TeamColor | null;
					challenge_id?: string | null;
					set_id?: string | null;
					created_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					slug?: string;
					purpose?: NfcTagPurpose;
					team_color?: TeamColor | null;
					challenge_id?: string | null;
					set_id?: string | null;
					created_by?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			game_sets: {
				Row: {
					id: string;
					name: string;
					description: string | null;
					team_count: number;
					total_timer_seconds: number | null;
					expected_player_count: number | null;
					assignment_slots: string[];
					assignment_index: number;
					status: 'active' | 'inactive';
					play_state: 'joining' | 'playing' | 'recap';
					started_at: string | null;
					ended_at: string | null;
					recap_state: string;
					recap_ranking: string[];
					recap_reveal_index: number;
					battle_reveal_index: number;
					scores_hidden: boolean;
					nfc_lock_enabled: boolean;
					team_selection_mode: 'random' | 'selectable';
					last_results: Json | null;
					powerups_enabled: boolean;
					powerup_mode: 'threshold' | 'token_shop';
					powerup_config: Json;
					preset_slug: string | null;
					crown_holder_team_id: string | null;
					crown_payout_applied: boolean;
					/** Speler-/teamcookies van vóór dit moment zijn ongeldig (migratie 0079). */
					player_epoch: string;
					hard_gaan_window_minutes: number;
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					name: string;
					description?: string | null;
					team_count?: number;
					total_timer_seconds?: number | null;
					expected_player_count?: number | null;
					assignment_slots?: string[];
					assignment_index?: number;
					status?: 'active' | 'inactive';
					play_state?: 'joining' | 'playing' | 'recap';
					started_at?: string | null;
					ended_at?: string | null;
					recap_state?: string;
					recap_ranking?: string[];
					recap_reveal_index?: number;
					battle_reveal_index?: number;
					scores_hidden?: boolean;
					nfc_lock_enabled?: boolean;
					team_selection_mode?: 'random' | 'selectable';
					last_results?: Json | null;
					powerups_enabled?: boolean;
					powerup_mode?: 'threshold' | 'token_shop';
					powerup_config?: Json;
					preset_slug?: string | null;
					crown_holder_team_id?: string | null;
					crown_payout_applied?: boolean;
					player_epoch?: string;
					hard_gaan_window_minutes?: number;
					created_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					name?: string;
					description?: string | null;
					team_count?: number;
					total_timer_seconds?: number | null;
					expected_player_count?: number | null;
					assignment_slots?: string[];
					assignment_index?: number;
					status?: 'active' | 'inactive';
					play_state?: 'joining' | 'playing' | 'recap';
					started_at?: string | null;
					ended_at?: string | null;
					recap_state?: string;
					recap_ranking?: string[];
					recap_reveal_index?: number;
					battle_reveal_index?: number;
					scores_hidden?: boolean;
					nfc_lock_enabled?: boolean;
					team_selection_mode?: 'random' | 'selectable';
					last_results?: Json | null;
					powerups_enabled?: boolean;
					powerup_mode?: 'threshold' | 'token_shop';
					powerup_config?: Json;
					preset_slug?: string | null;
					crown_holder_team_id?: string | null;
					crown_payout_applied?: boolean;
					player_epoch?: string;
					hard_gaan_window_minutes?: number;
					created_by?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			set_challenges: {
				Row: {
					id: string;
					set_id: string;
					challenge_id: string;
					position: number;
					challenge_multiplier: number;
					created_by: string | null;
					battle_resolved_at: string | null;
					battle_ranking: Json | null;
				};
				Insert: {
					id?: string;
					set_id: string;
					challenge_id: string;
					position?: number;
					challenge_multiplier?: number;
					created_by?: string | null;
					battle_resolved_at?: string | null;
					battle_ranking?: Json | null;
				};
				Update: {
					id?: string;
					set_id?: string;
					challenge_id?: string;
					position?: number;
					challenge_multiplier?: number;
					created_by?: string | null;
					battle_resolved_at?: string | null;
					battle_ranking?: Json | null;
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
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					field: AnswerField;
					value: string;
					input_mode?: string;
					created_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					field?: AnswerField;
					value?: string;
					input_mode?: string;
					created_by?: string | null;
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
					/** LEGACY (0061): sorteersleutel van de verwijderde battle-ladderbonus.
					 *  Wordt niet meer geschreven of gelezen; de battle-ranglijst gebruikt
					 *  `score`. De kolom staat er nog omdat er geen migratie voor draaide. */
					battle_raw_score: number | null;
					// Migration 0077: how many non-bonus, non-grouping fields this
					// submission got FULL points on, out of how many there were. NULL on
					// rows written before that migration — the verdict is unrecoverable
					// afterwards, so NULL means "unknown" and drops out of any average.
					fields_correct: number | null;
					fields_total: number | null;
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
					battle_raw_score?: number | null;
					fields_correct?: number | null;
					fields_total?: number | null;
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
					battle_raw_score?: number | null;
					fields_correct?: number | null;
					fields_total?: number | null;
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
					streak_config: Json | null;
					tutorial_text: string | null;
				};
				Insert: {
					variant: string;
					points_config?: Json;
					streak_config?: Json | null;
					tutorial_text?: string | null;
				};
				Update: {
					variant?: string;
					points_config?: Json;
					streak_config?: Json | null;
					tutorial_text?: string | null;
				};
				Relationships: [];
			};
			challenge_unlocks: {
				Row: {
					id: string;
					challenge_id: string;
					team_id: string;
					set_id: string;
					unlocked_at: string;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					team_id: string;
					set_id: string;
					unlocked_at?: string;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					team_id?: string;
					set_id?: string;
					unlocked_at?: string;
				};
				Relationships: [];
			};
			challenge_hints_used: {
				Row: {
					id: string;
					challenge_id: string;
					team_id: string;
					used_at: string;
				};
				Insert: {
					id?: string;
					challenge_id: string;
					team_id: string;
					used_at?: string;
				};
				Update: {
					id?: string;
					challenge_id?: string;
					team_id?: string;
					used_at?: string;
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
			powerups: {
				Row: {
					id: string;
					slug: string;
					name: string;
					description: string;
					category: PowerupCategory;
					default_cost: number;
					default_visibility: PowerupVisibility;
					target_type: PowerupTargetType;
					effect_payload: Json;
					sort_order: number;
					created_at: string;
				};
				Insert: {
					id?: string;
					slug: string;
					name: string;
					description: string;
					category: PowerupCategory;
					default_cost?: number;
					default_visibility?: PowerupVisibility;
					target_type: PowerupTargetType;
					effect_payload?: Json;
					sort_order?: number;
					created_at?: string;
				};
				Update: {
					id?: string;
					slug?: string;
					name?: string;
					description?: string;
					category?: PowerupCategory;
					default_cost?: number;
					default_visibility?: PowerupVisibility;
					target_type?: PowerupTargetType;
					effect_payload?: Json;
					sort_order?: number;
					created_at?: string;
				};
				Relationships: [];
			};
			set_powerups: {
				Row: {
					id: string;
					set_id: string;
					powerup_id: string;
					enabled: boolean;
					cost_override: number | null;
					visibility_override: PowerupVisibility | null;
					effect_payload_override: Json;
					created_at: string;
				};
				Insert: {
					id?: string;
					set_id: string;
					powerup_id: string;
					enabled?: boolean;
					cost_override?: number | null;
					visibility_override?: PowerupVisibility | null;
					effect_payload_override?: Json;
					created_at?: string;
				};
				Update: {
					id?: string;
					set_id?: string;
					powerup_id?: string;
					enabled?: boolean;
					cost_override?: number | null;
					visibility_override?: PowerupVisibility | null;
					effect_payload_override?: Json;
					created_at?: string;
				};
				Relationships: [];
			};
			powerup_usages: {
				Row: {
					id: string;
					set_id: string;
					powerup_id: string;
					attacker_team_id: string;
					target_team_id: string | null;
					challenge_id: string | null;
					cost_paid: number;
					used_at: string;
					effect_payload: Json;
					effect_ends_at: string | null;
					effect_resolved: boolean;
					visibility: string;
				};
				Insert: {
					id?: string;
					set_id: string;
					powerup_id: string;
					attacker_team_id: string;
					target_team_id?: string | null;
					challenge_id?: string | null;
					cost_paid: number;
					used_at?: string;
					effect_payload?: Json;
					effect_ends_at?: string | null;
					effect_resolved?: boolean;
					visibility: string;
				};
				Update: {
					id?: string;
					set_id?: string;
					powerup_id?: string;
					attacker_team_id?: string;
					target_team_id?: string | null;
					challenge_id?: string | null;
					cost_paid?: number;
					used_at?: string;
					effect_payload?: Json;
					effect_ends_at?: string | null;
					effect_resolved?: boolean;
					visibility?: string;
				};
				Relationships: [];
			};
			effect_presets: {
				Row: {
					id: string;
					name: string;
					effects: Json;
					is_builtin: boolean;
					created_by: string | null;
					created_at: string;
				};
				Insert: {
					id?: string;
					name: string;
					effects: Json;
					is_builtin?: boolean;
					created_by?: string | null;
					created_at?: string;
				};
				Update: {
					id?: string;
					name?: string;
					effects?: Json;
					is_builtin?: boolean;
					created_by?: string | null;
					created_at?: string;
				};
				Relationships: [];
			};
			powerup_types: {
				Row: {
					id: string;
					name: string;
					category:
						| 'defensive'
						| 'self'
						| 'information'
						| 'offensive'
						| 'social'
						| 'punishment'
						| 'wildcard';
					description: string | null;
					immediate_use: boolean;
					holdable: boolean;
					default_min_score_pct: number;
					default_max_score_pct: number;
					sort_order: number;
					icon: string | null;
					enabled_by_default: boolean;
					coming_soon: boolean;
					default_inverse: boolean;
					// Power band of the type (migration 0072). A fixed trait, like
					// `category` — NOT a per-set setting. Read by power_spin's roll pool
					// and nothing else; the earning planner ignores it.
					tier: PowerupTier;
					created_at: string;
				};
				Insert: {
					id: string;
					name: string;
					category:
						| 'defensive'
						| 'self'
						| 'information'
						| 'offensive'
						| 'social'
						| 'punishment'
						| 'wildcard';
					description?: string | null;
					immediate_use?: boolean;
					holdable?: boolean;
					default_min_score_pct?: number;
					default_max_score_pct?: number;
					sort_order?: number;
					icon?: string | null;
					enabled_by_default?: boolean;
					coming_soon?: boolean;
					default_inverse?: boolean;
					tier?: PowerupTier;
					created_at?: string;
				};
				Update: {
					id?: string;
					name?: string;
					category?:
						| 'defensive'
						| 'self'
						| 'information'
						| 'offensive'
						| 'social'
						| 'punishment'
						| 'wildcard';
					description?: string | null;
					immediate_use?: boolean;
					holdable?: boolean;
					default_min_score_pct?: number;
					default_max_score_pct?: number;
					sort_order?: number;
					icon?: string | null;
					enabled_by_default?: boolean;
					coming_soon?: boolean;
					default_inverse?: boolean;
					tier?: PowerupTier;
					created_at?: string;
				};
				Relationships: [];
			};
			team_powerups: {
				Row: {
					id: string;
					team_id: string;
					set_id: string | null;
					powerup_type_id: string;
					granted_at: string;
					granted_from_challenge_id: string | null;
					used_at: string | null;
					status: 'pending' | 'held' | 'used' | 'lost' | 'active' | 'consumed';
					payload: Json;
					// Migratie 0082 — wanneer de speler de kaart van deze toekenning
					// weggetikt heeft. NULL = nog niet gezien. Zie de migratie voor waarom
					// dit een eigen veld is en niet de status.
					acknowledged_at: string | null;
				};
				Insert: {
					id?: string;
					team_id: string;
					set_id?: string | null;
					powerup_type_id: string;
					granted_at?: string;
					granted_from_challenge_id?: string | null;
					used_at?: string | null;
					status?: 'pending' | 'held' | 'used' | 'lost' | 'active' | 'consumed';
					payload?: Json;
					acknowledged_at?: string | null;
				};
				Update: {
					id?: string;
					team_id?: string;
					set_id?: string | null;
					powerup_type_id?: string;
					granted_at?: string;
					granted_from_challenge_id?: string | null;
					used_at?: string | null;
					status?: 'pending' | 'held' | 'used' | 'lost' | 'active' | 'consumed';
					payload?: Json;
					acknowledged_at?: string | null;
				};
				Relationships: [];
			};
			team_effects: {
				Row: {
					id: string;
					team_id: string;
					set_id: string | null;
					effect_type: string;
					payload: Json;
					activated_at: string;
					expires_at: string | null;
					consumed_at: string | null;
					consumed_challenge_id: string | null;
					source_team_powerup_id: string | null;
				};
				Insert: {
					id?: string;
					team_id: string;
					set_id?: string | null;
					effect_type: string;
					payload?: Json;
					activated_at?: string;
					expires_at?: string | null;
					consumed_at?: string | null;
					consumed_challenge_id?: string | null;
					source_team_powerup_id?: string | null;
				};
				Update: {
					id?: string;
					team_id?: string;
					set_id?: string | null;
					effect_type?: string;
					payload?: Json;
					activated_at?: string;
					expires_at?: string | null;
					consumed_at?: string | null;
					consumed_challenge_id?: string | null;
					source_team_powerup_id?: string | null;
				};
				Relationships: [];
			};
			host_whitelist: {
				Row: {
					id: string;
					email: string;
					added_by: string | null;
					added_at: string;
					is_super_admin: boolean;
					notes: string | null;
				};
				Insert: {
					id?: string;
					email: string;
					added_by?: string | null;
					added_at?: string;
					is_super_admin?: boolean;
					notes?: string | null;
				};
				Update: {
					id?: string;
					email?: string;
					added_by?: string | null;
					added_at?: string;
					is_super_admin?: boolean;
					notes?: string | null;
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
export type GameSetRow = Database['public']['Tables']['game_sets']['Row'];
export type SetChallengeRow = Database['public']['Tables']['set_challenges']['Row'];
export type TeamRow = Database['public']['Tables']['teams']['Row'];
export type TrackRow = Database['public']['Tables']['tracks']['Row'];
export type ClipRow = Database['public']['Tables']['clips']['Row'];
export type ChallengeRow = Database['public']['Tables']['challenges']['Row'];
export type ChallengeTabRow = Database['public']['Tables']['challenge_tabs']['Row'];
export type ChallengeTabSourceTrackRow =
	Database['public']['Tables']['challenge_tab_source_tracks']['Row'];
export type ChallengeTabClipRow = Database['public']['Tables']['challenge_tab_clips']['Row'];
export type MashupRow = Database['public']['Tables']['mashups']['Row'];
export type MashupSourceRow = Database['public']['Tables']['mashup_sources']['Row'];
export type AttemptRow = Database['public']['Tables']['challenge_attempts']['Row'];
export type AnswerOptionRow = Database['public']['Tables']['answer_options']['Row'];
export type SubmissionRow = Database['public']['Tables']['submissions']['Row'];
export type NfcTagRow = Database['public']['Tables']['nfc_tags']['Row'];
export type ActivityLogRow = Database['public']['Tables']['activity_log']['Row'];
export type ReviewRequestRow = Database['public']['Tables']['review_requests']['Row'];
export type VariantDefaultRow = Database['public']['Tables']['variant_defaults']['Row'];
export type ChallengeHintUsedRow = Database['public']['Tables']['challenge_hints_used']['Row'];
export type ChallengeUnlockRow = Database['public']['Tables']['challenge_unlocks']['Row'];
export type AnswerPoolArtistRow = Database['public']['Tables']['answer_pool_artists']['Row'];
export type AnswerPoolLabelRow = Database['public']['Tables']['answer_pool_labels']['Row'];
export type AnswerPoolFestivalRow = Database['public']['Tables']['answer_pool_festivals']['Row'];
export type AnswerPoolVocalSourceRow =
	Database['public']['Tables']['answer_pool_vocal_sources']['Row'];
export type PowerupRow = Database['public']['Tables']['powerups']['Row'];
export type SetPowerupRow = Database['public']['Tables']['set_powerups']['Row'];
export type PowerupUsageRow = Database['public']['Tables']['powerup_usages']['Row'];
export type EffectPresetRow = Database['public']['Tables']['effect_presets']['Row'];
