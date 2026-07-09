// Shared config + CLI parsing for the Playwright player-bot harness.
// All bot code lives under /tests/bots (outside src/) so it never enters the
// SvelteKit/Vercel bundle.

/** Base URL of the running app. Override with BOT_BASE_URL env var. */
export const BOT_BASE_URL = process.env.BOT_BASE_URL ?? 'http://localhost:5173';

/**
 * Pull the target game-set UUID from CLI args.
 * Supports both `--set <uuid>` and `--set=<uuid>` forms.
 * Throws with a helpful message if absent — a bot run is meaningless without one.
 */
export function parseSetId(argv: string[]): string {
	const flagIdx = argv.indexOf('--set');
	if (flagIdx !== -1 && argv[flagIdx + 1]) return argv[flagIdx + 1];

	const inline = argv.find((a) => a.startsWith('--set='));
	if (inline) return inline.slice('--set='.length);

	throw new Error(
		'Missing required --set <uuid> argument.\n' +
			'Usage: npm run bots:join -- --set <game-set-uuid> [--count N]'
	);
}

/** Path to the fixtures JSON file. `--fixtures <path>`, default example.json. */
export function parseFixturesPath(argv: string[], fallback = 'tests/bots/fixtures/example.json'): string {
	const flagIdx = argv.indexOf('--fixtures');
	if (flagIdx !== -1 && argv[flagIdx + 1]) return argv[flagIdx + 1];
	const inline = argv.find((a) => a.startsWith('--fixtures='));
	if (inline) return inline.slice('--fixtures='.length);
	return fallback;
}

/** Number of player bots to spin up. `--count N`, default 2. */
export function parseCount(argv: string[], fallback = 2): number {
	const flagIdx = argv.indexOf('--count');
	if (flagIdx !== -1 && argv[flagIdx + 1]) {
		const n = parseInt(argv[flagIdx + 1], 10);
		if (!isNaN(n) && n > 0) return n;
	}
	const inline = argv.find((a) => a.startsWith('--count='));
	if (inline) {
		const n = parseInt(inline.slice('--count='.length), 10);
		if (!isNaN(n) && n > 0) return n;
	}
	return fallback;
}
