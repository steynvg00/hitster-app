<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		isTargetedPowerup,
		isTimerPowerup,
		doubleDownMultiplier,
		DOUBLE_DOWN_MIN_PCT,
		DOUBLE_DOWN_MAX_PCT,
		X_RAY_MAX_REVEALS,
		type RevealResult,
		type RevealTarget
	} from '$lib/powerups-meta';
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

	// One tab of the challenge, as far as a reveal picker needs to know it: which
	// fields it has and how many answer slots. x_ray picks cells out of the tab
	// being played.
	type RevealTab = {
		id: string;
		label: string;
		fields: string[];
		slotCount: number;
	};

	let {
		teamPowerupId,
		type: powerupType,
		onclose,
		currentChallengeId,
		variantFields = [],
		tabId,
		slotIndex = 0,
		revealTabs = [],
		targetTeams = [],
		activateAction = '?/activatePowerup'
	}: {
		teamPowerupId: string;
		type: PowerupType;
		// `reveals` is a LIST because x_ray produces several at once.
		// free_answer hands back a one-element list — one apply path on the page, not
		// one per powerup.
		onclose: (activated?: boolean, reveals?: RevealResult[]) => void;
		currentChallengeId?: string;
		// free_answer: the fields of the tab being answered, and the (tab, slot) the
		// reveal is addressed to. A field name alone does not identify an answer on a
		// multi-tab challenge or a multi-source (mashup / fragments) tab.
		variantFields?: string[];
		tabId?: string;
		slotIndex?: number;
		// x_ray only: every tab of this challenge with its fields and slot count, so
		// the picker can address the tab being played by id rather than by position.
		revealTabs?: RevealTab[];
		targetTeams?: TargetTeam[];
		// The form action to POST to. Defaults to the held-powerup activation path
		// (?/activatePowerup, requires status='held'). The reveal modal's "Use now"
		// flow (a fresh, still-pending earn) reuses this same component but points it
		// at a pending-specific action instead — same targeting UI, different action.
		activateAction?: string;
	} = $props();

	let activating = $state(false);
	let activateError = $state('');
	// `grouping` (fragments) is scored across the whole tab, not per track, so it
	// has no single value to reveal — the server refuses it and it is not offered.
	const revealableFields = $derived(variantFields.filter((f) => f !== 'grouping'));
	let selectedField = $state(variantFields.filter((f) => f !== 'grouping')[0] ?? '');
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
		lucky_dice: {
			action: 'Roll the dice — whatever you roll is added as bonus points to your next submission.'
		},
		x_ray: {
			action: `Pick up to ${X_RAY_MAX_REVEALS} answers on this tab — each one is revealed and filled in for you.`,
			warning: 'Requires an active challenge.'
		},
		double_down: {
			action:
				'Predict how much of the next challenge you will score. Hit your prediction and your points go up by that percentage — miss it and they go down by it.',
			warning: 'Can only be set BEFORE a challenge starts. It applies to your next submission.'
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

	// ── x_ray cell picker ─────────────────────────────────────────────────────
	//
	// Builds a list of (tab, slot, field) addresses — the SAME address free_answer's
	// single field + tab_id + slot_index form, five of them instead of one. Nothing
	// is resolved client-side: the addresses go to the server and come back as
	// answers from free_answer's resolver.
	const needsCellPicker = $derived(powerupType.id === 'x_ray');

	// `grouping` is scored across a whole tab rather than per track, so it has no
	// single answer — excluded from every picker, exactly as free_answer excludes it.
	const revealable = (fields: string[]) => fields.filter((f) => f !== 'grouping');

	// The tab being played, from the list; falls back to the props the free_answer
	// path already gets, so a caller that passes no revealTabs still works.
	const currentTab = $derived<RevealTab | undefined>(
		revealTabs.find((t) => t.id === tabId) ??
			(tabId ? { id: tabId, label: 'This tab', fields: variantFields, slotCount: 1 } : undefined)
	);

	type Cell = { slotIndex: number; field: string; key: string; label: string };
	const cells = $derived<Cell[]>(
		currentTab
			? Array.from({ length: Math.max(currentTab.slotCount, 1) }, (_, si) =>
					revealable(currentTab.fields).map((f) => ({
						slotIndex: si,
						field: f,
						key: `${si}:${f}`,
						// Slot numbering matches the answer-slot buttons on the challenge page
						// (1-based); a single-slot tab shows the field name alone.
						label:
							currentTab.slotCount > 1
								? `${si + 1} · ${f.replace(/_/g, ' ')}`
								: f.replace(/_/g, ' ')
					}))
				).flat()
			: []
	);

	let selectedCells = $state<string[]>([]);
	function toggleCell(key: string) {
		if (selectedCells.includes(key)) {
			selectedCells = selectedCells.filter((k) => k !== key);
		} else if (selectedCells.length < X_RAY_MAX_REVEALS) {
			selectedCells = [...selectedCells, key];
		}
	}

	// What actually gets posted. Built here so the "how many answers will this
	// reveal" preview below and the hidden input can never disagree.
	const revealTargets = $derived<RevealTarget[]>(
		needsCellPicker
			? selectedCells.map((k) => {
					const [si, ...rest] = k.split(':');
					return { tabId, slotIndex: Number(si), field: rest.join(':') };
				})
			: []
	);
	const targetsMissing = $derived(needsCellPicker && revealTargets.length === 0);
	// double_down asks for a NUMBER rather than a choice from a list — the first
	// powerup to do so. It travels by the same hidden-input mechanism free_answer's
	// field picker uses; only the control differs.
	const needsPrediction = $derived(powerupType.id === 'double_down');
	let predictedPct = $state(50);
	// Both outcomes, from the SAME function the scorer runs ($lib/powerups-meta) —
	// the team sees the exact multipliers it is betting on, not a restated rule.
	const hitMultiplier = $derived(doubleDownMultiplier(predictedPct, 100));
	const missMultiplier = $derived(doubleDownMultiplier(predictedPct, 0));
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
		['time_boost', 'insurance', 'free_answer', 'x_ray'].includes(powerupType.id)
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
					| {
							activated?: boolean;
							revealedValue?: string;
							revealedTags?: string[];
							revealedTabId?: string;
							revealedSlotIndex?: number;
							reveals?: RevealResult[];
							blocked?: boolean;
					  }
					| undefined;
				if (needsTarget) {
					// Show a caster-side confirmation (blocked vs sent), then close on OK.
					resultState = data?.blocked ? 'blocked' : 'sent';
				} else {
					// Only hand back a reveal when the server resolved a full address for
					// it; anything less would be keyed to the wrong tab/slot.
					const reveal: RevealResult | undefined =
						needsFieldPicker &&
						data?.revealedValue &&
						data.revealedTabId &&
						typeof data.revealedSlotIndex === 'number'
							? {
									value: data.revealedValue,
									...(data.revealedTags?.length ? { tags: data.revealedTags } : {}),
									field: selectedField,
									tabId: data.revealedTabId,
									slotIndex: data.revealedSlotIndex
								}
							: undefined;
					// One shape leaves this modal: a list. free_answer's single reveal
					// becomes a one-element list; x_ray hands back the list the
					// server already addressed for them (which may be SHORTER than what was
					// asked for — unresolvable cells are skipped server-side, see the
					// x_ray branch in powerups.ts).
					const reveals: RevealResult[] | undefined = data?.reveals?.length
						? data.reveals
						: reveal
							? [reveal]
							: undefined;
					onclose(true, reveals);
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
			{#if needsFieldPicker && revealableFields.length > 0}
				<div class="mb-4">
					<label class="mb-1.5 block text-xs font-semibold text-zinc-400"
						>Choose field to reveal</label
					>
					<select
						bind:value={selectedField}
						class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-amber-500"
					>
						{#each revealableFields as f}
							<option value={f}>{f.replace('_', ' ')}</option>
						{/each}
					</select>
				</div>
			{/if}

			<!-- Cell picker for x_ray: up to 5 answers on the tab being played -->
			{#if needsCellPicker}
				<div class="mb-4">
					<div class="mb-1.5 flex items-baseline justify-between">
						<span class="text-xs font-semibold text-zinc-400">Choose answers to reveal</span>
						<span class="text-xs font-bold text-amber-300"
							>{selectedCells.length}/{X_RAY_MAX_REVEALS}</span
						>
					</div>
					{#if cells.length === 0}
						<p class="rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-500">
							No answers available on this tab.
						</p>
					{:else}
						<div class="flex flex-wrap gap-1.5">
							{#each cells as c (c.key)}
								{@const on = selectedCells.includes(c.key)}
								<button
									type="button"
									onclick={() => toggleCell(c.key)}
									disabled={!on && selectedCells.length >= X_RAY_MAX_REVEALS}
									class="rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors {on
										? 'border-amber-400 bg-amber-400/10 text-amber-200'
										: selectedCells.length >= X_RAY_MAX_REVEALS
											? 'cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600'
											: 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'}"
								>
									{c.label}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Prediction slider for double_down -->
			{#if needsPrediction}
				<div class="mb-4">
					<div class="mb-1.5 flex items-baseline justify-between">
						<label for="double-down-pct" class="text-xs font-semibold text-zinc-400">
							Your prediction
						</label>
						<span class="text-2xl font-black text-amber-300">{predictedPct}%</span>
					</div>
					<input
						id="double-down-pct"
						type="range"
						min={DOUBLE_DOWN_MIN_PCT}
						max={DOUBLE_DOWN_MAX_PCT}
						step="1"
						bind:value={predictedPct}
						class="w-full accent-amber-400"
					/>
					<div class="mt-3 grid grid-cols-2 gap-2 text-center">
						<div class="rounded-lg border border-green-700/50 bg-green-950/40 px-2 py-1.5">
							<p class="text-[10px] font-semibold tracking-wide text-green-300/80 uppercase">
								Score {predictedPct}% or more
							</p>
							<p class="text-sm font-bold text-green-300">×{hitMultiplier.toFixed(2)}</p>
						</div>
						<div class="rounded-lg border border-red-800/50 bg-red-950/40 px-2 py-1.5">
							<p class="text-[10px] font-semibold tracking-wide text-red-300/80 uppercase">
								Score less
							</p>
							<p class="text-sm font-bold text-red-300">×{missMultiplier.toFixed(2)}</p>
						</div>
					</div>
					{#if predictedPct === 0}
						<p class="mt-2 text-xs text-zinc-500">
							At 0% the bet does nothing — your score is unchanged either way.
						</p>
					{/if}
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
							<!-- Addresses the reveal to the tab/slot being answered. Without
							     these the server only resolves a single-tab challenge. -->
							{#if tabId}
								<input type="hidden" name="tab_id" value={tabId} />
							{/if}
							<input type="hidden" name="slot_index" value={slotIndex} />
						{/if}
						{#if needsTarget && selectedTargetId}
							<input type="hidden" name="target_team_id" value={selectedTargetId} />
						{/if}
						{#if needsPrediction}
							<input type="hidden" name="predicted_pct" value={predictedPct} />
						{/if}
						{#if revealTargets.length > 0}
							<!-- x_ray: the whole address list in one field
							     (parseRevealTargets on the server). -->
							<input type="hidden" name="reveal_targets" value={JSON.stringify(revealTargets)} />
						{/if}
						<button
							type="submit"
							disabled={activating ||
								(needsFieldPicker && !selectedField) ||
								targetMissing ||
								targetsMissing}
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
