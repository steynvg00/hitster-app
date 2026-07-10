import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createAdminClient } from '$lib/server/supabase';
import { clearCrownAndPowerups } from '$lib/server/reset';

export const load: PageServerLoad = async () => {
	const db = createAdminClient();

	const [teamsResult, subsResult] = await Promise.all([
		db.from('teams').select('*').order('score', { ascending: false }),
		db.from('submissions').select('team_id')
	]);

	const teams = teamsResult.data ?? [];
	const subs = subsResult.data ?? [];

	const subCount: Record<string, number> = {};
	for (const s of subs) {
		subCount[s.team_id] = (subCount[s.team_id] ?? 0) + 1;
	}

	return {
		teams: teams.map((t) => ({ ...t, submissionCount: subCount[t.id] ?? 0 }))
	};
};

export const actions: Actions = {
	adjustScore: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const team_id = data.get('team_id') as string;
		const delta = parseInt(data.get('delta') as string, 10);
		const reason = (data.get('reason') as string)?.trim();

		if (!team_id || isNaN(delta)) return fail(400, { error: 'team_id and delta are required' });
		if (!reason) return fail(400, { error: 'A reason is required for score adjustments' });

		const { data: team } = await db.from('teams').select('score').eq('id', team_id).single();
		if (!team) return fail(404, { error: 'Team not found' });

		const newScore = Math.max(0, (team.score ?? 0) + delta);

		const { data: teamRow } = await db
			.from('teams')
			.select('display_name')
			.eq('id', team_id)
			.single();

		const [updateRes] = await Promise.all([
			db.from('teams').update({ score: newScore }).eq('id', team_id),
			db.from('activity_log').insert({
				event_type: 'score_adjustment',
				team_id,
				payload: { delta, reason, old_score: team.score, new_score: newScore }
			})
		]);

		if (updateRes.error) return fail(500, { error: updateRes.error.message });
		const sign = delta >= 0 ? '+' : '';
		const teamName = teamRow?.display_name ?? 'Team';
		return { success: true, message: `Score updated: ${teamName} ${sign}${delta} pts` };
	},

	resetScore: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();
		const team_id = data.get('team_id') as string;
		if (!team_id) return fail(400, { error: 'Missing team_id' });

		const { data: team } = await db.from('teams').select('score').eq('id', team_id).single();

		await Promise.all([
			db.from('teams').update({ score: 0 }).eq('id', team_id),
			db.from('activity_log').insert({
				event_type: 'score_reset',
				team_id,
				payload: { old_score: team?.score ?? 0, reason: 'manual reset by host' }
			})
		]);

		return { success: true };
	},

	updateDisplayName: async ({ request }) => {
		const db = createAdminClient();
		const data = await request.formData();

		const team_id = data.get('team_id') as string;
		const display_name = (data.get('display_name') as string)?.trim();

		if (!team_id || !display_name)
			return fail(400, { error: 'team_id and display_name are required' });

		const { error } = await db.from('teams').update({ display_name }).eq('id', team_id);
		if (error) return fail(500, { error: error.message });
		return { success: true };
	},

	resetEverything: async () => {
		const db = createAdminClient();

		// Active set ids — crown/powerup/effect clearing is scoped to these,
		// matching the documented soft-reset SQL (CLAUDE.md) but narrowed to
		// active sets rather than every game_sets row ever created.
		const { data: activeSets } = await db.from('game_sets').select('id').eq('status', 'active');
		const activeSetIds = (activeSets ?? []).map((s) => s.id);

		await Promise.all([
			db.from('submissions').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
			db.from('review_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
			db.from('activity_log').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
			db.from('challenge_attempts').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
			db
				.from('teams')
				.update({
					score: 0,
					current_streak: 0,
					held_powerups: [] as never,
					last_threshold_crossed: 0
				} as never)
				.neq('id', '00000000-0000-0000-0000-000000000000')
		]);

		// Crown/powerup hygiene via the shared helper, per active set.
		// teamIds: [] — the global teams update above already zeroed the
		// powerup fields for every team.
		const errors: string[] = [];
		for (const setId of activeSetIds) {
			errors.push(...(await clearCrownAndPowerups(db, setId, [], 'resetEverything')));
		}
		if (errors.length > 0) return fail(500, { error: `Reset failed: ${errors.join('; ')}` });

		await db
			.from('challenges')
			.update({ status: 'active', is_active: true })
			.neq('status', 'active');

		return { success: true, action: 'resetEverything' };
	},

	uploadPhoto: async ({ request }) => {
		const db = createAdminClient();
		const formData = await request.formData();
		const teamId = formData.get('team_id') as string | null;
		const file = formData.get('photo') as File | null;

		if (!teamId) return fail(400, { error: 'Missing team_id' });
		if (!file || file.size === 0) return fail(400, { error: 'No file provided' });
		if (!file.type.startsWith('image/')) return fail(400, { error: 'File must be an image' });
		if (file.size > 2 * 1024 * 1024) return fail(400, { error: 'Image must be ≤ 2 MB' });

		const ext = file.name.split('.').pop() ?? 'jpg';
		const path = `${teamId}.${ext}`;

		const { error: uploadErr } = await db.storage
			.from('team-photos')
			.upload(path, file, { contentType: file.type, upsert: true });

		if (uploadErr) return fail(500, { error: `Upload failed: ${uploadErr.message}` });

		const { data: urlData } = db.storage.from('team-photos').getPublicUrl(path);
		const photo_url = urlData.publicUrl;

		const { error: updateErr } = await db
			.from('teams')
			.update({ photo_url } as never)
			.eq('id', teamId);
		if (updateErr) return fail(500, { error: updateErr.message });

		return { success: true };
	}
};
