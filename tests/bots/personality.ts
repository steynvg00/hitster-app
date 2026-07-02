// Minimal bot "personality". v1 = a single accuracy applied to every bot.
// Varied per-bot personalities are DEFERRED to a later prompt.

export type Accuracy = 'correct' | 'wrong' | 'garbage';

export interface Plan {
	/** How the bot answers every field. */
	accuracy: Accuracy;
}

const VALID: Accuracy[] = ['correct', 'wrong', 'garbage'];

/** Parse `--accuracy <correct|wrong|garbage>` (default: correct). */
export function parseAccuracy(argv: string[], fallback: Accuracy = 'correct'): Accuracy {
	const flagIdx = argv.indexOf('--accuracy');
	const raw =
		flagIdx !== -1 && argv[flagIdx + 1]
			? argv[flagIdx + 1]
			: argv.find((a) => a.startsWith('--accuracy='))?.slice('--accuracy='.length);

	if (!raw) return fallback;
	if ((VALID as string[]).includes(raw)) return raw as Accuracy;

	console.warn(`Unknown --accuracy "${raw}" — falling back to "${fallback}"`);
	return fallback;
}
