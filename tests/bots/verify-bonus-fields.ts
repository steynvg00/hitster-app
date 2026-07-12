// Scoring-core verification for per-challenge configurable fields + bonus flag
// (configurable-fields stuk 1).
//
//   npm run bots:verify-bonus
//
// Pure-function harness — NO app, NO DB, NO Playwright. scoring.ts has only
// `import type` dependencies, so it runs standalone under tsx (the type imports
// are erased at transpile time). This asserts the two-max split directly on
// scoreSubmission + resolveChallengeFields, complementing verify-earning /
// verify-regression (which prove EXISTING challenges are unchanged).

import {
	resolveChallengeFields,
	fieldMapsFromResolved,
	scoreSubmission,
	TYPE_FIELDS,
	type TabInput,
	type TabSourceTrackData,
	type BonusParams,
	type TrackData
} from '../../src/lib/server/scoring';

// ── tiny assert harness ───────────────────────────────────────────────────────
type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function assert(name: string, got: unknown, want: unknown) {
	const pass = JSON.stringify(got) === JSON.stringify(want);
	checks.push({ name, pass, detail: pass ? `${JSON.stringify(got)}` : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}` });
}

// ── fixtures ──────────────────────────────────────────────────────────────────
const TRACK: TrackData = { id: 't1', artist: 'Headhunterz', title: 'Dragonborn', year: 2012 };

const neutralBonus = (over: Partial<BonusParams> = {}): BonusParams => ({
	difficulty_rating: 3, // → 1.0×
	challenge_multiplier: 1,
	team_score: 0,
	leader_score: 0,
	current_streak: 0,
	streak_thresholds: [],
	elapsed_seconds: null,
	speed_threshold_seconds: null,
	...over
});

// A standard-variant challenge with a configurable fields[]: artist is the real
// task (10 pts, non-bonus), title is a bonus (5 pts).
const pointsConfig = {
	fields: [
		{ name: 'artist', input_mode: 'open_text', max_points: 10, is_bonus: false },
		{ name: 'title', input_mode: 'open_text', max_points: 5, is_bonus: true }
	]
};

const resolved = resolveChallengeFields('standard', pointsConfig);
const { fields: variantFields, fieldModes, fieldPoints, bonusFields } = fieldMapsFromResolved(resolved);

function tabInputs(fieldValues: Record<string, string>): TabInput[] {
	const src: TabSourceTrackData = {
		id: 's1',
		tabId: 'tab1',
		trackId: TRACK.id,
		sortOrder: 0,
		track: TRACK
	};
	return [
		{ tabId: 'tab1', tabPosition: 0, sourceTracks: [src], clips: [], playerDraft: [{ fieldValues }] }
	];
}

function score(fieldValues: Record<string, string>, bonus?: BonusParams) {
	return scoreSubmission(tabInputs(fieldValues), variantFields, fieldModes, fieldPoints, bonus, bonusFields)
		.result;
}

const pct = (r: { thresholdTotal?: number; thresholdMax?: number }) =>
	(r.thresholdMax ?? 0) > 0 ? ((r.thresholdTotal ?? 0) / (r.thresholdMax ?? 1)) * 100 : 0;

// ── resolveChallengeFields with no fields[] == TYPE_FIELDS[variant] ────────────
for (const variant of Object.keys(TYPE_FIELDS)) {
	const r = resolveChallengeFields(variant, {});
	assert(`resolve(${variant}) names == TYPE_FIELDS`, r.map((f) => f.name), TYPE_FIELDS[variant]);
	assert(`resolve(${variant}) all non-bonus`, r.every((f) => f.is_bonus === false), true);
}

// ── A: ace everything → score includes bonus, thresholdPct == 100 (not >100) ──
{
	const r = score({ artist: 'Headhunterz', title: 'Dragonborn' });
	assert('A total includes bonus (10+5)', r.total, 15);
	assert('A maxTotal includes bonus (10+5)', r.maxTotal, 15);
	assert('A thresholdTotal excludes bonus (10)', r.thresholdTotal, 10);
	assert('A thresholdMax excludes bonus (10)', r.thresholdMax, 10);
	assert('A thresholdPct == 100 (not >100)', pct(r), 100);
	assert('A status auto_correct', r.status, 'auto_correct');
	// "Earns the same bands as without the bonus field": pct identical to an
	// artist-only (no-bonus) challenge acing artist.
	const artistOnly = resolveChallengeFields('standard', {
		fields: [{ name: 'artist', input_mode: 'open_text', max_points: 10, is_bonus: false }]
	});
	const ao = fieldMapsFromResolved(artistOnly);
	const rAO = scoreSubmission(tabInputs({ artist: 'Headhunterz' }), ao.fields, ao.fieldModes, ao.fieldPoints, undefined, ao.bonusFields).result;
	assert('A thresholdPct == artist-only pct (same bands)', pct(r), pct(rAO));
}

// ── B: ace ONLY the bonus field → thresholdPct 0, but score > 0 ───────────────
{
	const r = score({ artist: '', title: 'Dragonborn' });
	assert('B score > 0 (bonus counts to score)', r.total, 5);
	assert('B thresholdTotal == 0 (numerator excludes bonus)', r.thresholdTotal, 0);
	assert('B thresholdPct == 0 → earns nothing', pct(r), 0);
	assert('B status auto_wrong (threshold not perfect)', r.status, 'auto_wrong');
}

// ── C: insurance floors to 50% of thresholdMax (bonus excluded) ───────────────
{
	// Empty draft, insurance active. thresholdMax=10 → floor(10*0.5)=5.
	// If insurance (wrongly) used the full max 15 → floor(15*0.5)=7. So base==5 proves it.
	const r = score({ artist: '', title: '' }, neutralBonus({ insuranceActive: true }));
	assert('C insurance base floored to 50% of thresholdMax (5, not 7)', r.breakdown?.base, 5);
}

// ── D: auto_correct when non-bonus perfect even if bonus is blank ─────────────
{
	const r = score({ artist: 'Headhunterz', title: '' });
	assert('D status auto_correct (bonus blank, main perfect)', r.status, 'auto_correct');
	assert('D score == 10 (no bonus earned)', r.total, 10);
	assert('D thresholdPct == 100', pct(r), 100);
}

// ── report ────────────────────────────────────────────────────────────────────
console.log('─── configurable-fields scoring-core (stuk 1) ───');
for (const c of checks) {
	console.log(`  ${c.pass ? '✅' : '❌'} ${c.name.padEnd(52)} ${c.pass ? '' : c.detail}`);
}
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
if (passed !== checks.length) process.exit(1);
