// Fixture loader: ground-truth answers for challenges so bots can play them
// "correct" or "wrong". Keyed by challenge id. A challenge with no fixture
// entry is played with garbage answers (unknown track).
//
// Shape (tests/bots/fixtures/<file>.json):
//   {
//     "setId": "<game-set-uuid>",
//     "challenges": [
//       {
//         "id": "<challenge-uuid>",
//         "variant": "standard",
//         "fields": { "artist": "...", "title": "...", "year": 2015,
//                     "record_label": "...", "festival": "..." },
//         "accepted_titles": ["...", "..."]
//       }
//     ]
//   }
//
// NOTE: this is a hand-authored file for now. A DB-driven generator that reads
// the real tracks table is DEFERRED to a later prompt.

import { readFileSync } from 'node:fs';

export interface FixtureFields {
	artist?: string;
	title?: string;
	year?: number | string;
	record_label?: string;
	festival?: string;
}

export interface FixtureChallenge {
	id: string;
	variant: string;
	fields: FixtureFields;
	accepted_titles?: string[];
}

export interface FixtureFile {
	setId: string;
	challenges: FixtureChallenge[];
}

/** Read + parse a fixtures file. Throws on missing file or malformed JSON. */
export function loadFixtures(path: string): FixtureFile {
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		throw new Error(`Fixtures file not found: ${path}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`Fixtures file is not valid JSON (${path}): ${String(err)}`);
	}

	const file = parsed as Partial<FixtureFile>;
	return {
		setId: typeof file.setId === 'string' ? file.setId : '',
		challenges: Array.isArray(file.challenges) ? file.challenges : []
	};
}

/** Build a lookup of challenge id → fixture entry. */
export function fixtureMap(file: FixtureFile): Map<string, FixtureChallenge> {
	return new Map(file.challenges.map((c) => [c.id, c]));
}
