<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { isTargetedPowerup, isTimerPowerup } from '$lib/powerups-meta';
	import { supabaseBrowser } from '$lib/supabase-browser';

	type PowerupType = {
		id: string;
		name: string;
		icon: string | null;
		description: string | null;
		holdable: boolean;
		immediate_use: boolean;
	};

	type TargetTeam = {
		id: string;
		color: string;
		display_name: string;
		hasActiveTimedAttempt?: boolean;
	};

	let {
		teamPowerupId,
		type: powerupType,
		onclose,
		currentChallengeId,
		variantFields = [],
		targetTeams = [],
		activateAction = '?/activatePowerup'
	}: {
		teamPowerupId: string;
		type: PowerupType;
		onclose: (activated?: boolean, revealedValue?: string, revealedField?: string) => void;
		currentChallengeId?: string;
		variantFields?: string[];
		targetTeams?: TargetTeam[];
		// The form action to POST to. Defaults to the held-powerup activation path
		// (?/activatePowerup, requires status='held'). The reveal modal's "Use now"
		// flow (a fresh, still-pending earn) reuses this same component but points it
		// at a pending-specific action instead — same targeting UI, different action.
		activateAction?: string;
	} = $props();

	let activating = $state(false);
	let activateError = $state('');
	let selectedField = $state(variantFields[0] ?? '');
	let selectedTargetId = $state('');
	// After a targeted attack resolves, show a confirmation instead of auto-closing.
	let resultState = $state<'idle' | 'sent' | 'blocked'>('idle');

	const TEAM_HEX: Record<string, string> = {
		blue: '#3b82f6',
		yellow: '#eab308',
		green: '#22c55e',
		red: '#ef4444',
		indigo: '#6366f1',
		black: '#1e293b'
	};

	const EFFECT_COPY: Record<string, { action: string; warning?: string }> = {
		bonus_points: {
			action: '+15 points added to your next submission total.'
		},
		single_event_mult: {
			action: '1.5× multiplier applied to your next challenge final score.'
		},
		hard_gaan: {
			action: '1.5× multiplier on ALL submissions for the next 15 minutes.'
		},
		shield: {
			action: 'Shield activated — blocks one incoming attack from another team, then breaks.'
		},
		time_boost: {
			action: '+30 seconds added to the current challenge timer.',
			warning: 'Requires an active timed challenge.'
		},
		insurance: {
			action:
				'Insurance activated — if your base score is below 50% of max, it will be floored to 50%.',
			warning: 'Will be consumed when you submit this challenge.'
		},
		free_answer: {
			action: 'One field will be revealed for you. Choose which field to unlock.',
			warning: 'Requires an active challenge.'
		},
		give_a_shot: {
			action:
				'Pick a team — they take a real-world shot 🥂. No effect on scores. Blocked if they have a shield up.'
		},
		freeze: {
			action: "Freezes a target team's challenge timer for ~30 seconds."
		},
		time_drain: {
			action: "Drains ~15 seconds from a target team's challenge timer."
		},
		tap_to_break: {
			action: 'Forces a target team to tap through a lock before they can submit.'
		}
	};

	const copy = $derived(EFFECT_COPY[powerupType.id] ?? { action: powerupType.description ?? '' });
	const needsFieldPicker = $derived(powerupType.id === 'free_answer');
	const needsTarget = $derived(isTargetedPowerup(powerupType.id));
	// Timer attacks (freeze/time_drain) can only hit a team currently in a timed
	// challenge — grey the rest. give_a_shot ignores this (all teams targetable).
	const timerGated = $derived(isTimerPowerup(powerupType.id));

	// Live targetability (realtime follow-up): the `hasActiveTimedAttempt` prop is
	// a load-time snapshot — a team can start/finish a timed challenge while this
	// picker is open. null = no live data yet, fall back to the snapshot prop.
	// challenge_attempts realtime rows carry no timer_seconds/set_id, so we can't
	// derive targetability from the payload alone — re-running the batched
	// predicate server-side on every relevant event (debounced) is simplest-correct
	// (see /api/teams-timed-status). The server rejection at activation stays as
	// the safety net for the sub-second gap between an event and the click.
	let liveTimedTeamIds = $state<Set<string> | null>(null);
	function canTarget(t: TargetTeam): boolean {
		if (!timerGated) return true;
		if (liveTimedTeamIds) return liveTimedTeamIds.has(t.id);
		return t.hasActiveTimedAttempt === true;
	}

	let refetchTimer: ReturnType<typeof setTimeout> | undefined;
	async function refetchTimedStatus() {
		const ids = targetTeams.map((t) => t.id);
		if (!ids.length) return;
		try {
			const res = await fetch(`/api/teams-timed-status?team_ids=${ids.join(',')}`);
			if (!res.ok) return;
			const data = (await res.json()) as { timedTeamIds: string[] };
			liveTimedTeamIds = new Set(data.timedTeamIds);
		} catch {
			// Network hiccup — keep the last known state (snapshot or previous live set).
		}
	}
	function scheduleRefetch() {
		clearTimeout(refetchTimer);
		refetchTimer = setTimeout(refetchTimedStatus, 300);
	}

	// Only subscribe for timer powerups — give_a_shot never needs this and skips
	// the channel entirely. Scoped to this modal instance's lifetime: subscribes
	// on mount, unsubscribes on close/unmount (unique channel per teamPowerupId).
	$effect(() => {
		if (!timerGated) return;
		refetchTimedStatus(); // correct any staleness from the page-load snapshot immediately
		const channel = supabaseBrowser
			.channel(`powerup-target-timed-${teamPowerupId}`)
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'challenge_attempts' },
				scheduleRefetch
			)
			.subscribe();
		return () => {
			clearTimeout(refetchTimer);
			supabaseBrowser.removeChannel(channel);
		};
	});
	const needsChallenge = $derived(
		['time_boost', 'insurance', 'free_answer'].includes(powerupType.id)
	);
	const gated = $derived(needsChallenge && !currentChallengeId);
	const targetName = $derived(
		targetTeams.find((t) => t.id === selectedTargetId)?.display_name ?? ''
	);
	// Can't fire a targeted powerup without a chosen target.
	const targetMissing = $derived(needsTarget && !selectedTargetId);

	const handleSubmit: SubmitFunction = () => {
		activating = true;
		activateError = '';
		return async ({ result, update }) => {
			await update({ reset: false });
			activating = false;
			if (result.type === 'success') {
				const data = result.data as
					| { activated?: boolean; revealedValue?: string; blocked?: boolean }
					| undefined;
				if (needsTarget) {
					// Show a caster-side confirmation (blocked vs sent), then close on OK.
					resultState = data?.blocked ? 'blocked' : 'sent';
				} else {
					onclose(true, data?.revealedValue, needsFieldPicker ? selectedField : undefined);
				}
			} else if (result.type === 'failure') {
				const data = result.data as { activateError?: string } | undefined;
				activateError = data?.activateError ?? 'Activation failed';
			}
		};
	};
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
>
	<div class="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
		<!-- Header -->
		<div class="mb-4 flex items-center gap-3">
			{#if powerupType.icon}
				<span class="text-3xl leading-none">{powerupType.icon}</span>
			{/if}
			<div>
				<p class="text-xs font-bold tracking-widest text-amber-400 uppercase">Activate Powerup</p>
				<p class="text-lg font-black text-white">{powerupType.name}</p>
			</div>
		</div>

		{#if resultState !== 'idle'}
			<!-- Caster-side confirmation for a targeted attack -->
			<div class="mb-4 rounded-xl border border-zinc-700 bg-zinc-800/60 p-4 text-center">
				{#if resultState === 'blocked'}
					<p class="text-3xl">🛡️</p>
					<p class="mt-2 text-sm font-bold text-amber-300">Blocked by their shield!</p>
					<p class="mt-1 text-xs text-zinc-400">
						{targetName} had a shield up — it absorbed your {powerupType.name}. Powerup spent.
					</p>
				{:else}
					<p class="text-3xl">{powerupType.icon ?? '🥂'}</p>
					<p class="mt-2 text-sm font-bold text-amber-300">Sent to {targetName}!</p>
				{/if}
			</div>
			<button
				type="button"
				onclick={() => onclose(true)}
				class="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
			>
				OK
			</button>
		{:else}
			<!-- Effect description -->
			<div class="mb-4 rounded-xl border border-zinc-700 bg-zinc-800/60 p-3">
				<p class="text-sm text-zinc-300">{copy.action}</p>
				{#if copy.warning}
					<p class="mt-1.5 text-xs text-amber-400/80">{copy.warning}</p>
				{/if}
			</div>

			<!-- Target picker for offensive/social powerups -->
			{#if needsTarget}
				<div class="mb-4">
					<p class="mb-1.5 text-xs font-semibold text-zinc-400">Choose a team to target</p>
					{#if targetTeams.length === 0}
						<p class="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-500">
							No other teams available to target.
						</p>
					{:else}
						<div class="grid grid-cols-2 gap-2">
							{#each targetTeams as t (t.id)}
								{@const targetable = canTarget(t)}
								<button
									type="button"
									disabled={!targetable}
									onclick={() => targetable && (selectedTargetId = t.id)}
									title={targetable ? '' : 'Not in a challenge right now'}
									class="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors {!targetable
										? 'cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600'
										: selectedTargetId === t.id
											? 'border-amber-400 bg-amber-400/10 text-white'
											: 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'}"
								>
									<span class="flex items-center gap-2">
										<span
											class="h-3.5 w-3.5 shrink-0 rounded-full {targetable ? '' : 'opacity-40'}"
											style="background-color: {TEAM_HEX[t.color] ?? '#6b7280'};"
										></span>
										<span class="truncate">{t.display_name}</span>
									</span>
									{#if !targetable}
										<span class="pl-5.5 text-[10px] font-normal text-zinc-600"
											>not in a challenge</span
										>
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Field picker for free_answer -->
			{#if needsFieldPicker && variantFields.length > 0}
				<div class="mb-4">
					<label class="mb-1.5 block text-xs font-semibold text-zinc-400"
						>Choose field to reveal</label
					>
					<select
						bind:value={selectedField}
						class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-500"
					>
						{#each variantFields as f}
							<option value={f}>{f.replace('_', ' ')}</option>
						{/each}
					</select>
				</div>
			{/if}

			<!-- Gate warning -->
			{#if gated}
				<p class="mb-4 rounded-lg bg-red-950/60 px-3 py-2 text-xs text-red-400">
					This powerup can only be activated during an active challenge.
				</p>
			{/if}

			<!-- Error -->
			{#if activateError}
				<p class="mb-3 text-xs text-red-400">{activateError}</p>
			{/if}

			<!-- Actions -->
			<div class="flex gap-3">
				{#if !gated}
					<form method="POST" action={activateAction} use:enhance={handleSubmit} class="flex-1">
						<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
						{#if currentChallengeId}
							<input type="hidden" name="current_challenge_id" value={currentChallengeId} />
						{/if}
						{#if needsFieldPicker && selectedField}
							<input type="hidden" name="field" value={selectedField} />
						{/if}
						{#if needsTarget && selectedTargetId}
							<input type="hidden" name="target_team_id" value={selectedTargetId} />
						{/if}
						<button
							type="submit"
							disabled={activating || (needsFieldPicker && !selectedField) || targetMissing}
							class="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
						>
							{activating ? 'Activating…' : 'Activate'}
						</button>
					</form>
				{/if}
				<button
					type="button"
					onclick={() => onclose(false)}
					class="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white {gated
						? 'flex-1'
						: ''}"
				>
					Cancel
				</button>
			</div>
		{/if}
	</div>
</div>
