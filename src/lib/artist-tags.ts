// The artist answer's tag-list wire format — the CONTRACT between the player's
// multi-select input (C1 stuk 2) and the scorer (C1 stuk 1).
//
// Client-safe and pure, deliberately: $lib/server/scoring.ts is server-only, so a
// .svelte component cannot import from it. Without this module the player UI would
// have to re-implement the split/join, and a divergence would silently score every
// multi-artist answer as one unmatched tag — no error, no crash, just wrong points.
// Same single-source-of-truth split as $lib/audio-limits (editor slider + Waveform)
// and $lib/battle-ranking (engine + harness).
//
// ONE TAG PER LINE. Newline is the separator precisely because no artist name
// contains one:
//   - A legacy single-input answer ("Sub Zero Project") has no newline, so it
//     parses to exactly one tag and scores identically to pre-C1. That's the whole
//     regression guarantee for every existing challenge.
//   - Splitting on " & " or "," was rejected: T1 joins a track's DISPLAY string
//     with " & ", and a single artist whose NAME contains an ampersand
//     ("Bass & Bassline") would be silently shredded into two never-matching tags.

export const ARTIST_TAG_SEPARATOR = '\n';

/** Wire string → tags. Blank/whitespace-only entries are dropped. */
export function parseArtistTags(submitted: string): string[] {
	return submitted
		.split(ARTIST_TAG_SEPARATOR)
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Tags → wire string. The inverse of parseArtistTags.
 *
 * A single tag joins to a plain string with no separator, which is what keeps a
 * single-artist submission byte-identical to pre-C1 — the scorer's regression
 * identity depends on this.
 */
export function joinArtistTags(tags: string[]): string {
	return tags
		.map((t) => t.trim())
		.filter(Boolean)
		.join(ARTIST_TAG_SEPARATOR);
}
