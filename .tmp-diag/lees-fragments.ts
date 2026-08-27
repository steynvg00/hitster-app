/** ALLEEN-LEZEND. Geen insert, update, delete of DDL — puur SELECT om de
 *  tab/clip/track-structuur van de fragments-challenges te kunnen zien. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
	readFileSync('.env', 'utf8')
		.split('\n')
		.filter((l) => l.includes('=') && !l.startsWith('#'))
		.map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const db = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: challenges } = await db
	.from('challenges')
	.select('id, title, variant, timer_seconds')
	.eq('variant', 'fragments');

console.log(`fragments-challenges: ${challenges?.length ?? 0}\n`);

for (const c of challenges ?? []) {
	const { data: tabs } = await db
		.from('challenge_tabs')
		.select('id, position')
		.eq('challenge_id', c.id)
		.order('position');
	console.log(`── ${c.title}  (${c.id.slice(0, 8)})  timer=${c.timer_seconds}`);
	console.log(`   tabs: ${tabs?.length ?? 0}`);
	for (const t of tabs ?? []) {
		const { data: tcs } = await db
			.from('challenge_tab_clips')
			.select('clip_id, sort_order')
			.eq('tab_id', t.id)
			.order('sort_order');
		const clipIds = (tcs ?? []).map((x) => x.clip_id);
		const { data: clips } = clipIds.length
			? await db.from('clips').select('*').in('id', clipIds)
			: { data: [] as any[] };
		const trackIds = [...new Set((clips ?? []).map((x) => x.track_id))];
		const { data: tracks } = trackIds.length
			? await db.from('tracks').select('id, title, artist, year').in('id', trackIds)
			: { data: [] as any[] };
		const distinct: string[] = [];
		for (const tc of tcs ?? []) {
			const cl = (clips ?? []).find((x) => x.id === tc.clip_id);
			if (cl && !distinct.includes(cl.track_id)) distinct.push(cl.track_id);
		}
		console.log(
			`     tab pos ${t.position}: ${tcs?.length ?? 0} clips -> ${distinct.length} distinct tracks (= slots)`
		);
		for (const tc of tcs ?? []) {
			const cl = (clips ?? []).find((x) => x.id === tc.clip_id);
			const tr = (tracks ?? []).find((x) => x.id === cl?.track_id);
			console.log(
				`        sort ${tc.sort_order}  clip ${String(cl?.fragment_number ?? cl?.label ?? '?').padEnd(14)} -> ${tr?.artist ?? '?'} — ${tr?.title ?? '?'} (${tr?.year ?? '?'})`
			);
		}
	}
	console.log();
}

// Jaarbereik van ALLE tracks — voor de jaar-slider.
const { data: alle } = await db.from('tracks').select('year').not('year', 'is', null);
const jaren = (alle ?? []).map((t: any) => t.year).filter((y) => typeof y === 'number');
jaren.sort((a, b) => a - b);
console.log(`tracks met jaar: ${jaren.length}   min ${jaren[0]}   max ${jaren[jaren.length - 1]}`);
console.log(`onder 2000: ${jaren.filter((y) => y < 2000).join(', ') || 'geen'}`);
