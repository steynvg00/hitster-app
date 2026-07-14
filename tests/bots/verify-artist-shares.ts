// Artist multi-target share scoring verification (C1 stuk 1).
//
//   npm run bots:verify-artist-shares
//
// Pure-function harness — NO app, NO DB, NO Playwright (same mold as
// verify-battle / verify-bonus-fields / verify-recap-flow). scoring.ts has only
// `import type` deps, so it runs standalone under tsx.
//
// THE MODEL under test:
//   MAIN artists share the artist field's points: share = max / mainCount, each
//     matched against the submitted tags; per pair >=0.80 → full share,
//     0.65–0.80 → half share, else 0.
//   BONUS artists (marked per-challenge in points_config.artist_bonus) are worth
//     their own points ON TOP, matched against the tags the mains didn't take. A
//     missing bonus artist costs nothing — exactly like a blank bonus field.
//   OVER-GUESS: only when tags > targets. surplus = tags − targets;
//     penalty = surplus × PENALTY_PER_SURPLUS_TAG, applied to MAIN only.
//   FLOOR: main can never go below 0. Bonus is never reduced by the penalty.
//
// The regression guarantee (first section): a single-artist track answered with a
// single tag scores byte-identically to pre-C1 — that's the whole safety story for
// every existing challenge, since no track has an artists[] list until a host
// edits one and no challenge has artist_bonus until C1 stuk 2 ships.
//
// Fuzzy fixtures use REAL similarity values probed from strSimilarity, not
// invented ones: "Headhuntr" vs "Headhunterz" = 0.818 (full tier), "Headhunt" =
// 0.727 (half tier), "Headhun" = 0.545 (no match).

import {
	scoreArtistField,
	scoreField,
	resolveArtistBonus,
	parseArtistTags,
	artistTargets,
	scoreSubmission,
	resolveChallengeFields,
	fieldMapsFromResolved,
	PENALTY_PER_SURPLUS_TAG,
	type TrackData,
	type TabInput,
	type TabSourceTrackData
} from '../../src/lib/server/scoring';

// ── tiny assert harness ───────────────────────────────────────────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({
		name,
		pass,
		detail: pass ? `${JSON.stringify(got)}` : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`
	});
}

const MAX = 10;
const tags = (...t: string[]) => t;
/** Main score only, the common case. */
const main = (submitted: string[], targets: string[], bonus = {}, mode: 'open_text' | 'combobox' = 'open_text') =>
	scoreArtistField(submitted, targets, MAX, bonus, mode).mainScore;

// ── 1. Regression identity: 1 main, 1 tag, no bonus ───────────────────────────
console.log('\n── Regression identity (1 artist, 1 tag) ──');
assert('exact match → full field', main(tags('Headhunterz'), ['Headhunterz']), 10);
assert('0.818 sim → full (>=0.80 tier)', main(tags('Headhuntr'), ['Headhunterz']), 10);
assert('0.727 sim → half (0.65–0.80 tier)', main(tags('Headhunt'), ['Headhunterz']), 5);
assert('0.545 sim → zero (<0.65)', main(tags('Headhun'), ['Headhunterz']), 0);
assert('unrelated → zero', main(tags('Wildstylez'), ['Headhunterz']), 0);
assert('blank tag → zero', main(tags(''), ['Headhunterz']), 0);

// Identity via the real scoreField entry point + the artists[] fallback: a track
// with NO artists[] must resolve to [artist] and score exactly as above.
const legacyTrack: TrackData = { id: 't', artist: 'Headhunterz', title: 'X', year: 2012 };
assert('artistTargets falls back to scalar artist', artistTargets(legacyTrack), ['Headhunterz']);
assert(
	'scoreField artist exact → full',
	scoreField('artist', 'Headhunterz', legacyTrack, 'open_text', 10).score,
	10
);
assert(
	'scoreField artist emits no bonus split when no bonus artists',
	scoreField('artist', 'Headhunterz', legacyTrack, 'open_text', 10).bonusMax,
	0
);
assert(
	'artists[] present overrides the scalar',
	artistTargets({ ...legacyTrack, artists: ['Ran-D', 'Adaro'] }),
	['Ran-D', 'Adaro']
);
assert('empty artists[] falls back to scalar', artistTargets({ ...legacyTrack, artists: [] }), [
	'Headhunterz'
]);
assert(
	'blank scalar + no artists[] → no targets (unscorable)',
	artistTargets({ ...legacyTrack, artist: '' }),
	[]
);
assert('unscorable artist scores 0', main(tags('Anything'), []), 0);
assert(
	'unscorable artist keeps its max (model (a))',
	scoreArtistField(tags('Anything'), [], MAX).mainMax,
	10
);

// Exact-mode identity: combobox must stay EXACT, not fuzzy.
console.log('\n── Mode-awareness (combobox stays exact) ──');
assert('combobox exact → full', main(tags('Headhunterz'), ['Headhunterz'], {}, 'combobox'), 10);
assert('combobox near-miss → 0 (not fuzzy)', main(tags('Headhuntr'), ['Headhunterz'], {}, 'combobox'), 0);
assert('combobox case-insensitive → full', main(tags('headHUNTERZ'), ['Headhunterz'], {}, 'combobox'), 10);

// ── 2. Shares: 2 main artists ─────────────────────────────────────────────────
console.log('\n── Shares (2 main artists) ──');
const duo = ['Ran-D', 'Adaro'];
assert('both matched → full field', main(tags('Ran-D', 'Adaro'), duo), 10);
assert('both matched, order irrelevant', main(tags('Adaro', 'Ran-D'), duo), 10);
assert('one matched → half the field', main(tags('Ran-D'), duo), 5);
assert('other one matched → half the field', main(tags('Adaro'), duo), 5);
assert('neither matched → 0', main(tags('Wildstylez'), duo), 0);
assert('one matched + one wrong (within target count) → half, no penalty', main(tags('Ran-D', 'Wildstylez'), duo), 5);

// ── 3. Shares: 3 main artists (thirds) ────────────────────────────────────────
console.log('\n── Shares (3 main artists, thirds) ──');
const trio = ['Ran-D', 'Adaro', 'Radical Redemption'];
assert('3/3 matched → full', main(tags('Ran-D', 'Adaro', 'Radical Redemption'), trio), 10);
assert('2/3 matched → round(6.67) = 7', main(tags('Ran-D', 'Adaro'), trio), 7);
assert('1/3 matched → round(3.33) = 3', main(tags('Ran-D'), trio), 3);
assert('0/3 matched → 0', main(tags('Wildstylez'), trio), 0);

// ── 4. Fuzzy tiers apply PER PAIR against the share ───────────────────────────
console.log('\n── Fuzzy tiers per pair (against the share, not the field) ──');
// Probed sims (not guessed): Wildstyle→Wildstylez = 0.900 (full tier),
// Wildsty→Wildstylez = 0.700 (half tier), Headhunt→Headhunterz = 0.727 (half).
const pair = ['Headhunterz', 'Wildstylez'];
assert('two full matches → the whole field', main(tags('Headhunterz', 'Wildstyle'), pair), 10);
assert('one full + one half → 5 + 2.5 → round(7.5) = 8', main(tags('Headhunterz', 'Wildsty'), pair), 8);
assert('one half only → round(2.5) = 3', main(tags('Headhunt'), pair), 3);
assert('both half → 2.5 + 2.5 = 5', main(tags('Headhunt', 'Wildsty'), pair), 5);

// ── 5. Assignment maximises the total ─────────────────────────────────────────
console.log('\n── Assignment maximises the total (exact, not greedy) ──');
// THE case that separates exact from greedy — found by sweeping the name pool,
// not invented. targets [Headhunterz, Headhuntr] vs tags [Headhuntr, Headhunt]:
//   Headhuntr → Headhunterz 0.818 (full) | → Headhuntr 1.000 (full)
//   Headhunt  → Headhunterz 0.727 (half) | → Headhuntr 0.889 (full)
// Greedy takes the single best pair first (Headhuntr→Headhuntr, sim 1.000), which
// strands Headhunterz on the half-matching tag → 5 + 2.5 = 7.5 → 8. The exact
// assignment pairs Headhuntr→Headhunterz and Headhunt→Headhuntr for full+full=10.
// A player who guessed BOTH names well must not be docked for the pairing order.
assert(
	'a tag matching two targets goes where it frees the higher total',
	main(tags('Headhuntr', 'Headhunt'), ['Headhunterz', 'Headhuntr']),
	10
);
assert(
	'…and the same holds with the tags swapped (order-independent)',
	main(tags('Headhunt', 'Headhuntr'), ['Headhunterz', 'Headhuntr']),
	10
);
// Each tag is consumed at most once: one tag cannot satisfy two identical targets.
assert('one tag cannot fill two targets → half only', main(tags('Ran-D'), ['Ran-D', 'Ran-D']), 5);

// ── 6. Bonus artists ──────────────────────────────────────────────────────────
console.log('\n── Bonus artists (extra on top, absence free) ──');
const withMc = ['Ran-D', 'MC Villain'];
const mcBonus = { 'MC Villain': 5 };
const r_mcHit = scoreArtistField(tags('Ran-D', 'MC Villain'), withMc, MAX, mcBonus);
assert('bonus hit: main is the FULL field (1 main artist)', r_mcHit.mainScore, 10);
assert('bonus hit: bonus added', r_mcHit.bonusScore, 5);
assert('bonus hit: bonusMax reported', r_mcHit.bonusMax, 5);
assert('bonus hit: mainMax unchanged', r_mcHit.mainMax, 10);

const r_mcMiss = scoreArtistField(tags('Ran-D'), withMc, MAX, mcBonus);
assert('bonus MISS: main unchanged (absence is free)', r_mcMiss.mainScore, 10);
assert('bonus MISS: no bonus points', r_mcMiss.bonusScore, 0);
assert('bonus MISS: bonusMax still reported', r_mcMiss.bonusMax, 5);
assert('bonus MISS: no penalty (tags <= targets)', r_mcMiss.mainScore, 10);

assert(
	'bonus is case-insensitive in config lookup',
	scoreArtistField(tags('Ran-D', 'MC Villain'), withMc, MAX, { 'mc villain': 5 }).bonusScore,
	5
);
assert(
	'bonus artist not on the track → no bonusMax',
	scoreArtistField(tags('Ran-D'), ['Ran-D'], MAX, { 'MC Nobody': 5 }).bonusMax,
	0
);
assert(
	'bonus half-credit tier applies to the bonus value',
	scoreArtistField(tags('Headhunterz', 'Headhunt'), ['Headhunterz', 'Headhunterzz'], MAX, {
		Headhunterzz: 6
	}).bonusScore,
	3
);
// A bonus artist does NOT dilute the mains' share.
const r_twoMainOneBonus = scoreArtistField(
	tags('Ran-D', 'Adaro', 'MC Villain'),
	['Ran-D', 'Adaro', 'MC Villain'],
	MAX,
	mcBonus
);
assert('bonus does not dilute the main share: 2 mains → full 10', r_twoMainOneBonus.mainScore, 10);
assert('bonus on top of a full main', r_twoMainOneBonus.bonusScore, 5);

// ── 7. Over-guess penalty ─────────────────────────────────────────────────────
console.log('\n── Over-guess penalty (only when tags > targets) ──');
assert('PENALTY_PER_SURPLUS_TAG is 1', PENALTY_PER_SURPLUS_TAG, 1);
assert('tags == targets → no penalty', main(tags('Ran-D', 'Adaro'), duo), 10);
assert('tags < targets → no penalty (just the missed share)', main(tags('Ran-D'), duo), 5);
assert('1 surplus tag → −1', main(tags('Ran-D', 'Adaro', 'Wildstylez'), duo), 9);
assert('2 surplus tags → −2', main(tags('Ran-D', 'Adaro', 'Wildstylez', 'Radium'), duo), 8);
assert(
	'surplus counts tags, not misses: 3 tags vs 1 target → −2',
	main(tags('Headhunterz', 'Wildstylez', 'Radium'), ['Headhunterz']),
	8
);
assert('surplus applies even when nothing matched', main(tags('A', 'B', 'C'), ['Headhunterz']), 0);
// Bonus artists count toward the target total, so naming them isn't over-guessing.
assert(
	'a bonus target raises T → naming it is not surplus',
	scoreArtistField(tags('Ran-D', 'MC Villain'), withMc, MAX, mcBonus).mainScore,
	10
);
assert(
	'surplus beyond mains+bonus still penalised',
	scoreArtistField(tags('Ran-D', 'MC Villain', 'Wildstylez'), withMc, MAX, mcBonus).mainScore,
	9
);

// ── 8. Floor at zero + penalty hits main only ─────────────────────────────────
console.log('\n── Floor at zero, penalty hits MAIN only ──');
const heavy = tags('Ran-D', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K');
assert('heavy over-guess floors main at 0 (never negative)', main(heavy, ['Ran-D']), 0);
assert(
	'floor is exactly 0, not negative',
	scoreArtistField(heavy, ['Ran-D'], MAX).mainScore >= 0,
	true
);
const r_penaltyVsBonus = scoreArtistField(
	tags('Ran-D', 'MC Villain', 'X', 'Y', 'Z', 'W', 'V', 'U', 'T', 'S', 'R', 'Q'),
	withMc,
	MAX,
	mcBonus
);
assert('penalty drives main to the floor', r_penaltyVsBonus.mainScore, 0);
assert('penalty does NOT touch bonus', r_penaltyVsBonus.bonusScore, 5);

// ── 9. Tag parsing / wire format ──────────────────────────────────────────────
console.log('\n── Tag wire format (newline-separated) ──');
assert('single name → one tag (legacy identity)', parseArtistTags('Headhunterz'), ['Headhunterz']);
assert('newline-separated → tag list', parseArtistTags('Ran-D\nAdaro'), ['Ran-D', 'Adaro']);
assert('blank lines dropped', parseArtistTags('Ran-D\n\n  \nAdaro'), ['Ran-D', 'Adaro']);
assert('tags trimmed', parseArtistTags('  Ran-D  \n  Adaro '), ['Ran-D', 'Adaro']);
assert('empty string → no tags', parseArtistTags(''), []);
assert(
	'an ampersand in a NAME is not a separator (would shred a real artist)',
	parseArtistTags('Bass & Bassline'),
	['Bass & Bassline']
);

// ── 10. Config resolution ─────────────────────────────────────────────────────
console.log('\n── points_config.artist_bonus resolution ──');
assert('absent → {}', resolveArtistBonus({}), {});
assert('null config → {}', resolveArtistBonus(null), {});
assert('valid map passes through', resolveArtistBonus({ artist_bonus: { 'MC Villain': 5 } }), {
	'MC Villain': 5
});
assert('non-numeric value dropped', resolveArtistBonus({ artist_bonus: { A: 'x' } }), {});
assert('zero/negative dropped', resolveArtistBonus({ artist_bonus: { A: 0, B: -3 } }), {});
assert('blank name dropped', resolveArtistBonus({ artist_bonus: { '  ': 5 } }), {});
assert('array config ignored', resolveArtistBonus({ artist_bonus: [1, 2] }), {});

// ── 11. Integration: bonus artist stays OUT of thresholdMax ───────────────────
console.log('\n── Integration: bonus artist excluded from the threshold pair ──');
const intTrack: TrackData = {
	id: 't1',
	artist: 'Ran-D & MC Villain',
	artists: ['Ran-D', 'MC Villain'],
	title: 'Zombie',
	year: 2015
};
const intConfig = {
	fields: [
		{ name: 'artist', input_mode: 'open_text', max_points: 10, is_bonus: false },
		{ name: 'title', input_mode: 'open_text', max_points: 10, is_bonus: false }
	],
	artist_bonus: { 'MC Villain': 5 }
};
const intResolved = resolveChallengeFields('standard', intConfig);
const intMaps = fieldMapsFromResolved(intResolved);
const intArtistBonus = resolveArtistBonus(intConfig);

function intTabs(fieldValues: Record<string, string>): TabInput[] {
	const src: TabSourceTrackData = { id: 's1', tabId: 'tab1', trackId: intTrack.id, sortOrder: 0, track: intTrack };
	return [{ tabId: 'tab1', tabPosition: 0, sourceTracks: [src], clips: [], playerDraft: [{ fieldValues }] }];
}
const runInt = (fv: Record<string, string>) =>
	scoreSubmission(
		intTabs(fv),
		intMaps.fields,
		intMaps.fieldModes,
		intMaps.fieldPoints,
		undefined,
		intMaps.bonusFields,
		intArtistBonus
	).result;

// Main artist + title correct, bonus MC missed → threshold-perfect.
const noMc = runInt({ artist: 'Ran-D', title: 'Zombie' });
assert('main-only: total = 20 (10 artist + 10 title)', noMc.total, 20);
assert('main-only: thresholdTotal = 20', noMc.thresholdTotal, 20);
assert('main-only: thresholdMax = 20 (bonus artist excluded)', noMc.thresholdMax, 20);
assert('main-only: threshold-perfect → auto_correct despite the missing MC', noMc.status, 'auto_correct');
assert('main-only: display maxTotal = 25 (bonus artist visible in the max)', noMc.maxTotal, 25);

// Same, but the MC is named → +5 on top, threshold pair unmoved.
const withMcInt = runInt({ artist: 'Ran-D\nMC Villain', title: 'Zombie' });
assert('bonus hit: total = 25', withMcInt.total, 25);
assert('bonus hit: thresholdTotal still 20 (bonus not counted)', withMcInt.thresholdTotal, 20);
assert('bonus hit: thresholdMax still 20', withMcInt.thresholdMax, 20);
assert('bonus hit: still auto_correct', withMcInt.status, 'auto_correct');

// A pre-C1-shaped challenge (no artist_bonus, single-artist track) is untouched.
const plainTrack: TrackData = { id: 't2', artist: 'Ran-D', title: 'Zombie', year: 2015 };
const plainConfig = {
	fields: [
		{ name: 'artist', input_mode: 'open_text', max_points: 10, is_bonus: false },
		{ name: 'title', input_mode: 'open_text', max_points: 10, is_bonus: false }
	]
};
const plainResolved = resolveChallengeFields('standard', plainConfig);
const plainMaps = fieldMapsFromResolved(plainResolved);
const plainSrc: TabSourceTrackData = {
	id: 's1',
	tabId: 'tab1',
	trackId: plainTrack.id,
	sortOrder: 0,
	track: plainTrack
};
const plainRes = scoreSubmission(
	[
		{
			tabId: 'tab1',
			tabPosition: 0,
			sourceTracks: [plainSrc],
			clips: [],
			playerDraft: [{ fieldValues: { artist: 'Ran-D', title: 'Zombie' } }]
		}
	],
	plainMaps.fields,
	plainMaps.fieldModes,
	plainMaps.fieldPoints,
	undefined,
	plainMaps.bonusFields,
	resolveArtistBonus(plainConfig)
).result;
assert('pre-C1 challenge: total 20', plainRes.total, 20);
assert('pre-C1 challenge: thresholdMax 20', plainRes.thresholdMax, 20);
assert('pre-C1 challenge: maxTotal 20 (no bonus inflation)', plainRes.maxTotal, 20);
assert('pre-C1 challenge: auto_correct', plainRes.status, 'auto_correct');

// ── report ────────────────────────────────────────────────────────────────────
console.log('\n─── Results ───');
for (const c of checks) console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(58)} ${c.pass ? '' : c.detail}`);
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed !== checks.length) process.exit(1);
