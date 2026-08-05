<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import { doubleDownMultiplier } from '$lib/powerups-meta';

	type ActiveEffect = {
		id: string;
		effect_type: string;
		payload: Record<string, unknown>;
		expires_at: string | null;
	};

	let {
		teamId,
		setId,
		effects: initialEffects
	}: {
		teamId: string;
		setId: string;
		effects: ActiveEffect[];
	} = $props();

	// Incoming-attack effect rows target THIS team but aren't the team's own buffs —
	// give_a_shot is surfaced by IncomingEffectsListener's acknowledge modal, not as
	// a banner pill. Exclude them here so the banner only shows self-buffs.
	const BANNER_EXCLUDE = new Set(['give_a_shot', 'shield_block']);

	let effects = $state<ActiveEffect[]>(
		initialEffects.filter((e) => !isExpired(e) && !BANNER_EXCLUDE.has(e.effect_type))
	);
	let now = $state(Date.now());

	function isExpired(e: ActiveEffect): boolean {
		return !!e.expires_at && new Date(e.expires_at).getTime() <= Date.now();
	}

	function fmtCountdown(expiresAt: string): string {
		const rem = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
		const m = Math.floor(rem / 60);
		const s = rem % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	const EFFECT_LABEL: Record<string, string> = {
		bonus_points: '+15 ready',
		single_event_mult: '1.5× ready',
		hard_gaan: '🔥 Hard gaan',
		shield: '🛡 Shield ready',
		insurance: '🪙 Insurance ready',
		free_answer: '💡 Free answer',
		x_ray: '🔎 X-Ray',
		time_boost: '⏱ Time boost',
		double_down: '🎰 Double Down',
		// tap_to_break (stuk 3) is the one offensive attack that ISN'T pre-consumed,
		// so it survives to show here — useful on /team where the challenge page's
		// full-screen lock overlay isn't mounted.
		tap_to_break: '🔒 Locked — tap to break free'
	};

	function label(e: ActiveEffect): string {
		const base = EFFECT_LABEL[e.effect_type] ?? e.effect_type;
		if (e.effect_type === 'hard_gaan' && e.expires_at) {
			return `${base} — ${fmtCountdown(e.expires_at)} left`;
		}
		if (e.effect_type === 'single_event_mult') {
			const m = (e.payload.multiplier as number | undefined) ?? 1.5;
			return `${m}× next submission`;
		}
		if (e.effect_type === 'bonus_points') {
			const v = (e.payload.value as number | undefined) ?? 15;
			return `+${v} next submission`;
		}
		if (e.effect_type === 'x_ray') {
			// The remaining budget IS the pill's information — an X-Ray with 3 reveals
			// left and one with 1 are different situations to a team mid-challenge. The
			// counter is UPDATEd in place on every spend and this banner already
			// refetches on any team_effects change, so it counts down live.
			const n = e.payload.reveals_remaining as number | undefined;
			if (typeof n !== 'number') return base;
			return `${base} — ${n} reveal${n === 1 ? '' : 's'} left`;
		}
		if (e.effect_type === 'double_down') {
			// The prediction is the whole point of the pill: a team that has bet must be
			// able to see WHAT it bet while playing, not just that a bet is live.
			const g = e.payload.predicted_pct as number | undefined;
			if (typeof g !== 'number') return base;
			return `${base} — ${g}% predicted (×${doubleDownMultiplier(g, 100)} / ×${doubleDownMultiplier(g, 0)})`;
		}
		return base;
	}

	async function refetch() {
		const { data } = await supabaseBrowser
			.from('team_effects')
			.select('id, effect_type, payload, expires_at')
			.eq('team_id', teamId)
			.eq('set_id', setId)
			.is('consumed_at', null);
		effects = (data ?? [])
			.map((r) => ({
				id: r.id,
				effect_type: r.effect_type,
				payload: (r.payload ?? {}) as Record<string, unknown>,
				expires_at: r.expires_at
			}))
			.filter((e) => !isExpired(e) && !BANNER_EXCLUDE.has(e.effect_type));
	}

	onMount(() => {
		// Tick clock every second for hard_gaan countdown
		const tick = setInterval(() => {
			now = Date.now();
			// Prune expired window effects locally
			effects = effects.filter((e) => !isExpired(e));
		}, 1000);

		const channel = supabaseBrowser
			.channel(`active-effects-${teamId}-${setId}`)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'team_effects', filter: `team_id=eq.${teamId}` },
				() => refetch()
			)
			.subscribe();

		return () => {
			clearInterval(tick);
			supabaseBrowser.removeChannel(channel);
		};
	});
</script>

{#if effects.length > 0}
	<div class="flex flex-wrap gap-2 py-1">
		{#each effects as e (e.id)}
			<div
				class="flex items-center gap-1.5 rounded-lg border border-amber-600/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300"
			>
				{label(e)}
			</div>
		{/each}
	</div>
{/if}
