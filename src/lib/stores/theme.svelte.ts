export type ThemeName = 'led_stage' | 'sound_reactive' | 'tactical' | 'max_defqon';

const VALID: readonly ThemeName[] = ['led_stage', 'sound_reactive', 'tactical', 'max_defqon'];
const KEY = 'dashboard_theme';

let _theme = $state<ThemeName>('tactical');

export const themeStore = {
	get current(): ThemeName {
		return _theme;
	},
	init() {
		if (typeof localStorage === 'undefined') return;
		const stored = localStorage.getItem(KEY);
		if (stored && (VALID as readonly string[]).includes(stored)) {
			_theme = stored as ThemeName;
		}
	},
	set(name: ThemeName) {
		_theme = name;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(KEY, name);
		}
	}
};
