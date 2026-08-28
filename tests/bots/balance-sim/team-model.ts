// Het teammodel: hoe een team van niveau L een concept invult.
//
// Niveau L (0–100) is de kans dat een veld VOLLEDIG goed wordt ingevuld. Wat er
// gebeurt als het fout gaat, is gemodelleerd per veldsoort, zodat de ECHTE
// scorer (scoreSubmission) de deelpunten uitdeelt — het model verzint zelf
// nooit een score:
//   jaar        fout → 30 % er 1 naast, 20 % er 2 naast, 50 % ≥ 3 ernaast
//   tekstveld   fout → leeg
//   artiesten   elke naam onafhankelijk met kans L; 10 % kans op een extra
//               foute tag (surplus-straf)
//   grouping    elk fragment onafhankelijk met kans L op de juiste beurt; een
//               fragment dat fout gaat wordt vervangen door een willekeurig
//               nummer uit de tab (dat toevallig alsnog goed kan zijn). Het
//               aantal aangewezen nummers blijft gelijk aan het aantal dat de
//               track echt heeft, want dat is wat een speler doet: negen
//               fragmenten over drie beurten verdelen. Daardoor is er geen
//               surplus — de surplusstraf van scoreGrouping wordt in de
//               harness getest, niet hier.
//
// Onthullingen en aanvallen werken op het concept, niet op de score:
//   reveals     gekozen velden worden op het juiste antwoord gezet
//   hint        (lifeline) elk fout TEKSTveld wordt alsnog goed met kans P_LIFELINE
//               (een jaar maskeert tot "2___" en helpt niet — zie maskAnswer)
//   eye         elk fout veld wordt goed met kans P_EYE × niveau van het beste
//               team dat al klaar was (het team weet niet wie gelijk heeft)
//   aanval      niveau omlaag met ATTACK_PENALTY_PCT voor die challenge

import {
	artistTargets,
	groupingNumbersForTrack,
	type TabInput,
	type SlotDraft,
	type TabClipData
} from '../../../src/lib/server/scoring';
import { ARTIST_TAG_SEPARATOR } from '../../../src/lib/artist-tags';
import type { LoadedChallenge, Rng } from './types';

export const P_LIFELINE = 0.5;
export const P_EYE = 0.5;
export const ATTACK_PENALTY_PCT: Record<string, number> = {
	time_drain: 2,
	freeze: 4,
	tap_to_break: 2,
	give_a_shot: 0
};
export const P_SURPLUS_TAG = 0.1;

export type Cell = { tabIndex: number; slotIndex: number; field: string; maxPoints: number };

/** Alle invulbare cellen van een challenge, in tab/slot-volgorde. */
export function cellsOf(ch: LoadedChallenge): Cell[] {
	const out: Cell[] = [];
	ch.tabs.forEach((tab, ti) => {
		const fm = tab.fieldMaps!;
		tab.sourceTracks.forEach((_, si) => {
			for (const f of fm.fields)
				out.push({ tabIndex: ti, slotIndex: si, field: f, maxPoints: fm.fieldPoints[f] ?? 10 });
		});
	});
	return out;
}

export type DraftPlan = {
	level: number; // effectief niveau voor deze challenge (na aanvallen)
	reveals: Set<string>; // "ti:si:field" die goed gezet worden
	revealWholeTracks: Set<string>; // "ti:si" — free_tab
	lifeline: boolean;
	eyeBestLevel: number | null; // niveau van het beste al-klare team, of null
};

export const cellKey = (c: { tabIndex: number; slotIndex: number; field: string }) =>
	`${c.tabIndex}:${c.slotIndex}:${c.field}`;

/**
 * Alle fragmentnummers van een tab — de poel waaruit een speler kiest. Dat is
 * de hele tab en niet alleen de track, want de speler verdeelt álle fragmenten
 * over de beurten en weet niet welke bij welke track hoort.
 */
function allFragmentNumbers(tabClips: TabClipData[]): number[] {
	return [
		...new Set(
			tabClips.filter((c) => c.fragmentNumber !== null).map((c) => c.fragmentNumber as number)
		)
	].sort((a, b) => a - b);
}

/**
 * Bouw het concept van een team voor een challenge. Geeft naast de TabInputs
 * (met playerDraft gevuld) ook terug welke cellen door hulp goed werden — dat
 * is de basis voor de "punten uit onthullers"-post in het grootboek.
 */
export function buildDraft(
	ch: LoadedChallenge,
	plan: DraftPlan,
	rng: Rng
): { tabs: TabInput[]; helpedCells: Cell[] } {
	const p = Math.max(0, Math.min(1, plan.level / 100));
	const helped: Cell[] = [];

	const tabs: TabInput[] = ch.tabs.map((tab, ti) => {
		const fm = tab.fieldMaps!;
		const playerDraft: SlotDraft[] = tab.sourceTracks.map((src, si) => {
			const t = src.track;
			const fv: Record<string, string> = {};
			let fragments: number[] | undefined;
			const wholeTrack = plan.revealWholeTracks.has(`${ti}:${si}`);

			for (const field of fm.fields) {
				const key = `${ti}:${si}:${field}`;
				const max = fm.fieldPoints[field] ?? 10;
				const forced = wholeTrack || plan.reveals.has(key);
				let correct = forced || rng() < p;
				if (!correct && plan.eyeBestLevel !== null && rng() < P_EYE * (plan.eyeBestLevel / 100)) {
					correct = true;
					helped.push({ tabIndex: ti, slotIndex: si, field, maxPoints: max });
				} else if (!correct && plan.lifeline && field !== 'year' && rng() < P_LIFELINE) {
					correct = true;
					helped.push({ tabIndex: ti, slotIndex: si, field, maxPoints: max });
				} else if (forced) {
					// Alleen een onthulling op een veld dat anders fout was geweest is winst.
					if (!(rng() < p)) helped.push({ tabIndex: ti, slotIndex: si, field, maxPoints: max });
				}

				if (field === 'grouping') {
					const nums = groupingNumbersForTrack(tab.clips, t.id);
					if (correct) {
						fragments = nums;
					} else {
						// Per fragment: goed met kans p, anders een willekeurig nummer uit
						// de hele tab — dat toevallig alsnog juist kan zijn, wat precies de
						// gok-ondergrens is die scoreGrouping's regel met zich meebrengt.
						// Het AANTAL blijft gelijk aan wat de track echt heeft, dus geen
						// surplus; een speler verdeelt negen fragmenten over drie beurten.
						const pool = allFragmentNumbers(tab.clips);
						fragments = [
							...new Set(
								nums.map((n) => (rng() < p ? n : (pool[Math.floor(rng() * pool.length)] ?? n)))
							)
						];
					}
					continue;
				}
				if (field === 'year') {
					if (correct) fv.year = String(t.year);
					else {
						const r = rng();
						const off = r < 0.3 ? 1 : r < 0.5 ? 2 : 5;
						fv.year = String(t.year + (rng() < 0.5 ? -off : off));
					}
					continue;
				}
				if (field === 'artist') {
					const names = artistTargets(t);
					const tags = correct ? names.slice() : names.filter(() => rng() < p);
					if (!correct && rng() < P_SURPLUS_TAG) tags.push('Onbekend');
					fv.artist = tags.join(ARTIST_TAG_SEPARATOR);
					continue;
				}
				const value =
					field === 'title'
						? t.title
						: field === 'festival'
							? (t.festival ?? '')
							: field === 'label'
								? (t.record_label ?? '')
								: field === 'vocal_source'
									? (t.vocal_source ?? '')
									: '';
				fv[field] = correct ? value : '';
			}
			const draft: SlotDraft = { fieldValues: fv };
			if (fragments !== undefined) draft.fragments = fragments;
			return draft;
		});
		return { ...tab, playerDraft };
	});

	return { tabs, helpedCells: helped };
}

/** Geschatte speeltijd in seconden: sterke teams zijn sneller. */
export function elapsedSecondsFor(level: number, timerSeconds: number | null, rng: Rng): number {
	const timer = timerSeconds ?? 720;
	const base = timer * (0.9 - 0.6 * (level / 100)); // 95 % → ~0,33 × timer, 20 % → ~0,78 × timer
	return Math.max(45, Math.min(timer, Math.round(base + (rng() - 0.5) * 0.2 * timer)));
}
