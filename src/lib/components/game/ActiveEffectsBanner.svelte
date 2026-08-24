<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import { doubleDownMultiplier } from '$lib/powerups-meta';
	import { powerupIcon } from '$lib/mixup-assets';

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
		bonus_points: '+5 KLAAR',
		single_event_mult: 'MULTIPLIER KLAAR',
		hard_gaan: 'HARD GAAN',
		shield: 'SCHILD ACTIEF',
		insurance: 'VERZEKERING KLAAR',
		free_answer: 'GRATIS ANTWOORD',
		x_ray: 'X-RAY',
		time_boost: 'TIME BOOST',
		double_down: 'DOUBLE DOWN',
		// tap_to_break (stuk 3) is the one offensive attack that ISN'T pre-consumed,
		// so it survives to show here — useful on /team where the challenge page's
		// full-screen lock overlay isn't mounted.
		tap_to_break: 'VERGRENDELD — TIK JE VRIJ'
	};

	// Welke pil magenta is: een effect dat een ANDER team op jullie afvuurde.
	// Puur kleurkeuze — welke rijen hier staan bepaalt de filter hierboven.
	const INCOMING = new Set(['tap_to_break']);

	function label(e: ActiveEffect): string {
		const base = EFFECT_LABEL[e.effect_type] ?? e.effect_type;
		if (e.effect_type === 'hard_gaan' && e.expires_at) {
			return `${base} · ${fmtCountdown(e.expires_at)}`;
		}
		if (e.effect_type === 'single_event_mult') {
			// The multiplier is ROLLED at activation (x1.2/x1.4/x1.6), so the pill
			// must show what this team actually got. A row without one falls back to
			// the generic base label rather than naming a number nobody rolled.
			const m = e.payload.multiplier as number | undefined;
			if (typeof m !== 'number') return base;
			return `${m}x VOLGENDE INZENDING`;
		}
		if (e.effect_type === 'bonus_points') {
			const v = (e.payload.value as number | undefined) ?? 5;
			return `+${v} VOLGENDE INZENDING`;
		}
		if (e.effect_type === 'x_ray') {
			// The remaining budget IS the pill's information — an X-Ray with 3 reveals
			// left and one with 1 are different situations to a team mid-challenge. The
			// counter is UPDATEd in place on every spend and this banner already
			// refetches on any team_effects change, so it counts down live.
			const n = e.payload.reveals_remaining as number | undefined;
			if (typeof n !== 'number') return base;
			return `${base} · NOG ${n}`;
		}
		if (e.effect_type === 'double_down') {
			// The prediction is the whole point of the pill: a team that has bet must be
			// able to see WHAT it bet while playing, not just that a bet is live.
			const g = e.payload.predicted_pct as number | undefined;
			if (typeof g !== 'number') return base;
			return `${base} · ${g}% (x${doubleDownMultiplier(g, 100)} / x${doubleDownMultiplier(g, 0)})`;
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

<!--
	De effect-pillen uit scherm 1 van de designbron (fxPillStyle / fxPillWarn).
	PUUR PRESENTATIE: welke rijen hier staan, de filter erop en de realtime
	refetch zijn ongewijzigd — alleen vorm, kleur en taal veranderen.
-->
{#if effects.length > 0}
	<div class="flex flex-wrap gap-1.5 py-1">
		{#each effects as e (e.id)}
			<span class="fx-pill" class:fx-pill--warn={INCOMING.has(e.effect_type)}>
				<!-- Elke effect_type die hier een label heeft is ook een powerup-id, dus
				     het icoon bestaat. Een onbekend type valt terug op alleen tekst. -->
				<img
					src={powerupIcon(e.effect_type)}
					alt=""
					class="fx-pill-icon"
					onerror={(ev) => ((ev.currentTarget as HTMLImageElement).style.display = 'none')}
				/>
				{label(e)}
			</span>
		{/each}
	</div>
{/if}

<style>
	.fx-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border-radius: 999px;
		padding: 7px 12px;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 10px;
		letter-spacing: 0.08em;
		background: rgba(0, 229, 255, 0.07);
		border: 1px solid rgba(0, 229, 255, 0.4);
		color: #6fe8ff;
	}

	.fx-pill--warn {
		background: rgba(255, 45, 170, 0.07);
		border-color: rgba(255, 45, 170, 0.4);
		color: #ff6fc4;
	}

	.fx-pill-icon {
		width: 16px;
		height: 16px;
		object-fit: contain;
	}
</style>
