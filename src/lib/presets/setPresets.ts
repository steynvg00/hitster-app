export type SetPreset = {
	slug: string;
	name: string;
	description: string;
	icon: string;
	status: 'ready' | 'coming_soon';
	defaults?: {
		team_count?: number;
		total_timer_seconds?: number | null;
		powerups_enabled?: boolean;
		powerup_mode?: 'threshold' | 'token_shop';
		powerup_config?: object;
	};
	comingSoonNote?: string;
};

export const setPresets: SetPreset[] = [
	{
		slug: 'normal',
		name: 'Normal',
		description: 'Standard game, no powerups',
		icon: 'Sparkles',
		status: 'ready',
		defaults: { powerups_enabled: false }
	},
	{
		slug: 'party',
		name: 'Party',
		description: 'Random powerup drops at score milestones',
		icon: 'PartyPopper',
		status: 'ready',
		defaults: {
			powerups_enabled: true,
			powerup_mode: 'threshold',
			powerup_config: { thresholds_percent: [25, 50, 75] }
		}
	},
	{
		slug: 'token_shop',
		name: 'Token Shop',
		description: 'Earn tokens, spend on powerups',
		icon: 'Coins',
		status: 'ready',
		defaults: {
			powerups_enabled: true,
			powerup_mode: 'token_shop',
			powerup_config: {
				starting_tokens: 0,
				per_correct_challenge: 1,
				streak_bonuses: [
					{ streak: 3, bonus: 2 },
					{ streak: 5, bonus: 5 }
				],
				time_tick_minutes: null,
				tokens_per_tick: 1
			}
		}
	},
	{
		slug: 'quick_game',
		name: 'Quick Game',
		description: 'Short session, ~5 challenges recommended',
		icon: 'Zap',
		status: 'ready',
		defaults: { powerups_enabled: false, total_timer_seconds: 900 }
	},
	{
		slug: 'marathon',
		name: 'Marathon',
		description: 'Long session, all variants, 15+ challenges',
		icon: 'Mountain',
		status: 'ready',
		defaults: {
			powerups_enabled: true,
			powerup_mode: 'threshold',
			total_timer_seconds: 3600
		}
	},
	{
		slug: 'battles',
		name: 'Battles',
		description: '1v1 or team vs team — first correct answer wins',
		icon: 'Swords',
		status: 'coming_soon',
		comingSoonNote: 'Battle mechanic in development'
	},
	{
		slug: 'tournament',
		name: 'Tournament',
		description: 'Bracket-style elimination — last team standing',
		icon: 'Trophy',
		status: 'coming_soon',
		comingSoonNote: 'Requires Battles to be built first'
	},
	{
		slug: 'competition',
		name: 'Competition',
		description: 'Multi-game series, spans sessions — round-robin or tree',
		icon: 'Medal',
		status: 'coming_soon',
		comingSoonNote: 'Multi-session series support in development'
	},
	{
		slug: 'chaos',
		name: 'Chaos',
		description: 'Random disruption every round — unpredictable rounds',
		icon: 'Dices',
		status: 'coming_soon',
		comingSoonNote: 'Chaos-category powerups in development'
	},
	{
		slug: 'custom',
		name: 'Custom',
		description: 'Start blank and configure everything yourself',
		icon: 'FilePlus2',
		status: 'ready',
		defaults: {}
	}
];
