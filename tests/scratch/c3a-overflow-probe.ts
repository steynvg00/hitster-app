// C3a-1 diagnose-probe — tijdelijk script, GEEN onderdeel van de verify-suite.
// Roept scoreTab (src/lib/server/scoring.ts) direct aan met in-memory argumenten.
// Raakt GEEN database, GEEN netwerk, GEEN SvelteKit runtime.
//
// Stubs & waarom:
// - TrackData: plain objects (id/artist/title/year) — scoreTab leest alleen deze
//   velden via buildFieldResults; geen DB-row nodig.
// - TabSourceTrackData / TabClipData: met de hand opgebouwd; de id/tabId strings
//   zijn willekeurig (scoreTab gebruikt ze alleen als labels, nooit als lookup).
// - fieldModes: open_text voor alle velden — vermijdt combobox/pool-afhankelijkheid.
// - fieldPoints: {} → DEFAULT_FIELD_MAX (10 per veld) geldt.
// - bonusFields: leeg — alle velden tellen mee in threshold.
//
// Veldset: fragments-variant (artist, title, year, grouping) → minstens één
// non-bonus veld én grouping actief, zodat zowel de nonBonusFieldMax-add in de
// overflow-tak (scoring.ts:890) als de groupingMax-bijdrage zichtbaar is.
//
// Overflow-detectie: alleen de overflow-tak pusht een slotResult met
// matchedTrackId === null (scoring.ts:893) — daarop wordt geteld.
//
// Draaien: npx tsx tests/scratch/c3a-overflow-probe.ts

import {
	scoreTab,
	type TabSourceTrackData,
	type TabClipData,
	type SlotDraft,
	type TrackData
} from '../../src/lib/server/scoring';
import type { AnswerField, InputMode } from '../../src/lib/types/index';

const variantFields = ['artist', 'title', 'year', 'grouping'] as AnswerField[];
const fieldModes: Record<string, InputMode> = {
	artist: 'open_text',
	title: 'open_text',
	year: 'open_text',
	grouping: 'open_text'
};
const fieldPoints: Record<string, number> = {}; // → DEFAULT_FIELD_MAX (10 per veld)

function mkTrack(n: number): TrackData {
	return { id: `track-${n}`, artist: `Artist ${n}`, title: `Title ${n}`, year: 2000 + n };
}

function mkSources(count: number): TabSourceTrackData[] {
	return Array.from({ length: count }, (_, i) => ({
		id: `src-${i}`,
		tabId: 'tab-1',
		trackId: `track-${i}`,
		sortOrder: i,
		track: mkTrack(i)
	}));
}

// Twee fragment-clips per source track (fragmentNumber 2i+1, 2i+2).
function mkClips(trackCount: number): TabClipData[] {
	const clips: TabClipData[] = [];
	for (let i = 0; i < trackCount; i++) {
		for (const k of [0, 1]) {
			clips.push({
				id: `clip-${i}-${k}`,
				tabId: 'tab-1',
				clipId: `clipid-${i}-${k}`,
				fragmentNumber: i * 2 + k + 1,
				sortOrder: i * 2 + k,
				trackId: `track-${i}`
			});
		}
	}
	return clips;
}

// Slot i beantwoordt track i correct (incl. juiste fragments), zodat ook de
// matched-slot TOTALEN in de vergelijking meedoen (niet alleen de max).
// Slots voorbij het track-aantal (overflow) krijgen een garbage-antwoord.
function mkDrafts(slotCount: number): SlotDraft[] {
	return Array.from({ length: slotCount }, (_, i) => ({
		fieldValues: {
			artist: `Artist ${i}`,
			title: `Title ${i}`,
			year: String(2000 + i)
		},
		fragments: [i * 2 + 1, i * 2 + 2]
	}));
}

function runCase(name: string, trackCount: number, slotCount: number) {
	const result = scoreTab(
		variantFields,
		fieldModes,
		fieldPoints,
		mkSources(trackCount),
		mkClips(trackCount),
		mkDrafts(slotCount)
	);
	const overflowSlots = result.slotResults.filter((s) => s.matchedTrackId === null);
	console.log(`=== ${name} ===`);
	console.log(`tracks=${trackCount} slots=${slotCount}`);
	console.log(`overflow-tak geraakt: ${overflowSlots.length > 0 ? 'JA' : 'NEE'} (${overflowSlots.length} slot(s))`);
	console.log(`tabThresholdMax   = ${result.tabThresholdMax}`);
	console.log(`tabThresholdTotal = ${result.tabThresholdTotal}`);
	console.log(`tabMaxTotal       = ${result.tabMaxTotal}`);
	console.log(`tabTotal          = ${result.tabTotal}`);
	console.log(`RAW ${JSON.stringify(result)}`);
	console.log('');
}

runCase('CASE A (overflow, 0 tracks)', 0, 1);
runCase('CASE B (overflow, meervoud)', 3, 4);
runCase('CASE C (controle, normaal)', 3, 3);
