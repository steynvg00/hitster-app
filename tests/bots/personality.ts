// Bot behaviour lives entirely in a PROFILE. Every bot knows the full ground
// truth (from the DB-generated fixtures); the profile decides how much of it it
// actually gives correctly.
//
//   accuracy: 0..1  — each field is independently `accuracy`-likely to be correct
//   lazy: true      — clear the start gate (create the attempt) but NEVER submit,
//                     so the host-side auto-submit fires on the deadline
//
// Correct-vs-wrong per field is a DETERMINISTIC function of (team, challenge,
// field) — a run is reproducible and a given team is internally consistent.

export interface Profile {
	name: string;
	accuracy: number; // 0..1
	lazy?: boolean;
}

/** Named presets. Assign with --profiles ace,mid,sloppy,lazy (cycles). */
export const PRESETS: Record<string, Profile> = {
	ace: { name: 'ace', accuracy: 1.0 },
	sharp: { name: 'sharp', accuracy: 0.85 },
	mid: { name: 'mid', accuracy: 0.7 },
	sloppy: { name: 'sloppy', accuracy: 0.4 },
	lazy: { name: 'lazy', accuracy: 0, lazy: true }
};

// ── Deterministic seeded RNG (cyrb53-style) → a stable value in [0, 1) ─────────
function hashToUnit(str: string): number {
	let h1 = 0xdeadbeef ^ str.length;
	let h2 = 0x41c6ce57 ^ str.length;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
	return (combined % 1_000_000_000) / 1_000_000_000;
}

/**
 * Whether this team should answer `field` on `challengeId` correctly. Seeded on
 * (teamKey, challengeId, field) so it's reproducible and per-team consistent.
 */
export function fieldIsCorrect(
	profile: Profile,
	teamKey: string,
	challengeId: string,
	field: string
): boolean {
	if (profile.accuracy >= 1) return true;
	if (profile.accuracy <= 0) return false;
	return hashToUnit(`${teamKey}|${challengeId}|${field}`) < profile.accuracy;
}

// ── CLI parsing ───────────────────────────────────────────────────────────────
function flagValue(argv: string[], name: string): string | undefined {
	const idx = argv.indexOf(name);
	if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
	return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

/** `--accuracy <0..1>` shortcut → a number, or null if absent/invalid. */
export function parseAccuracy(argv: string[]): number | null {
	const raw = flagValue(argv, '--accuracy');
	if (raw === undefined) return null;
	const n = Number(raw);
	if (isNaN(n) || n < 0 || n > 1) {
		console.warn(`Ignoring --accuracy "${raw}" — must be a number in [0, 1]`);
		return null;
	}
	return n;
}

/**
 * Build one profile per bot. Priority: --profiles (named presets, cycled) >
 * --accuracy (one accuracy for all) > default (ace = everything correct).
 */
export function assignProfiles(argv: string[], count: number): Profile[] {
	const profilesRaw = flagValue(argv, '--profiles');
	if (profilesRaw) {
		const names = profilesRaw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		const profs = names.map((n) => {
			const p = PRESETS[n];
			if (!p) console.warn(`Unknown profile "${n}" — using "mid"`);
			return p ?? PRESETS.mid;
		});
		if (profs.length === 0) profs.push(PRESETS.ace);
		return Array.from({ length: count }, (_, i) => profs[i % profs.length]);
	}

	const acc = parseAccuracy(argv);
	if (acc !== null) {
		const p: Profile = { name: `acc:${acc}`, accuracy: acc };
		return Array.from({ length: count }, () => p);
	}

	return Array.from({ length: count }, () => PRESETS.ace);
}
