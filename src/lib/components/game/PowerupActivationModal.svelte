<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		isTargetedPowerup,
		isTimerPowerup,
		doubleDownMultiplier,
		DOUBLE_DOWN_MIN_PCT,
		DOUBLE_DOWN_MAX_PCT,
		X_RAY_DEFAULT_BUDGET,
		type LifelineHint,
		type RevealResult,
		type RevealTarget
	} from '$lib/powerups-meta';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import { goto } from '$app/navigation';
	import { powerupIcon } from '$lib/mixup-assets';
	import { portal } from '$lib/portal';
	import { teamHex } from '$lib/team-theme';
	import {
		fieldLabel,
		fireVerb,
		powerupAccent,
		powerupDesc,
		powerupName,
		powerupWarn
	} from '$lib/powerups-copy';

	type PowerupType = {
		id: string;
		name: string;
		icon: string | null;
		description: string | null;
		holdable: boolean;
		immediate_use: boolean;
		category?: string | null;
	};

	type TargetTeam = {
		id: string;
		color: string;
		display_name: string;
		hasActiveTimedAttempt?: boolean;
	};

	// One tab of the challenge, as far as the free_tab picker needs to know it:
	// which fields it has and how many answer slots.
	type RevealTab = {
		id: string;
		label: string;
		fields: string[];
		slotCount: number;
	};

	// One option in the Resurrection picker: a challenge this team has FINISHED.
	// `oldFinal` is what that submission gave the team score, `retrySeconds` the
	// clock the retry would run on (null = the challenge is untimed).
	type ResurrectableChallenge = {
		id: string;
		title: string;
		variant: string;
		oldFinal: number;
		retrySeconds: number | null;
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
		resurrectableChallenges = [],
		draftSnapshot,
		activateAction = '?/activatePowerup'
	}: {
		teamPowerupId: string;
		type: PowerupType;
		// `reveals` is a LIST because free_tab produces several at once. free_answer
		// hands back a one-element list — one apply path on the page, not one per
		// powerup.
		onclose: (activated?: boolean, reveals?: RevealResult[], hints?: LifelineHint[]) => void;
		currentChallengeId?: string;
		// free_answer: the fields of the tab being answered, and the (tab, slot) the
		// reveal is addressed to. A field name alone does not identify an answer on a
		// multi-tab challenge or a multi-source (mashup / fragments) tab.
		variantFields?: string[];
		tabId?: string;
		slotIndex?: number;
		// free_tab only: every tab of this challenge with its fields and slot count,
		// so the picker can address a tab the player is not currently looking at.
		revealTabs?: RevealTab[];
		targetTeams?: TargetTeam[];
		// resurrection only: the team's finished challenges, each with the score a
		// retry would be measured against and the 1/3 clock it would run on. Both
		// numbers come from the server (the same reader and the same helper the
		// activation itself uses), so what this modal promises is what will happen.
		resurrectableChallenges?: ResurrectableChallenge[];
		// lifeline only: the team's live draft, as the JSON the submit action already
		// speaks (Record<tabPosition, SlotDraft[]>). A FUNCTION, not a value, because
		// it must be read at the moment of activation — the team keeps typing while
		// this modal is open, and a snapshot taken at render time would judge answers
		// that are already stale. The challenge page passes its own
		// buildAnswersForSubmit, so what Lifeline judges is exactly what would be
		// scored. Absent (e.g. from /team, where there is no draft) the server treats
		// it as an empty draft — but lifeline is challenge-gated anyway, so that path
		// is refused before it matters.
		draftSnapshot?: () => string;
		// The form action to POST to. Defaults to the held-powerup activation path
		// (?/activatePowerup, requires status='held'). The reveal modal's "Use now"
		// flow (a fresh, still-pending earn) reuses this same component but points it
		// at a pending-specific action instead — same targeting UI, different action.
		activateAction?: string;
	} = $props();

	let activating = $state(false);
	let activateError = $state('');
	// ÁLLE velden van de tab die nu open staat, grouping inbegrepen.
	//
	// Grouping was uitgesloten op de grond dat het "over de hele tab" gescoord zou
	// worden en dus geen enkelvoudig antwoord had. Dat klopte niet: scoreTab scoort
	// het per slot, tegen de fragmentnummers van de track die aan dat slot gematcht
	// is. Bij fragments kon een team daardoor kiezen uit titel, artiest en jaar
	// maar niet uit de clipnummers — precies het deel dat de meeste punten kost.
	// De server lost het nu op via groupingAnswerForTrack.
	const revealableFields = $derived(variantFields);
	let selectedField = $state(variantFields[0] ?? '');
	let selectedTargetId = $state('');
	// After a targeted attack resolves, show a confirmation instead of auto-closing.
	// 'rolled' is the same idea for lucky_dice: an activation with an OUTCOME the
	// team has to see. Closing straight away — which is what every other self
	// powerup does, because their effect is a promise about a later submission —
	// threw the rolled number away, so the points appeared with no explanation.
	let resultState = $state<'idle' | 'sent' | 'blocked' | 'rolled'>('idle');
	let rolled = $state<{ value?: number; dice_min?: number; dice_max?: number; new_score?: number }>(
		{}
	);
	// Powerups whose activation resolves to a number the team must be shown. Only
	// lucky_dice today; the check is on the payload as well, so a type that starts
	// returning a roll gets the same treatment without another branch here.
	const showsRoll = $derived(powerupType.id === 'lucky_dice');

	// Redesign fase 4: de accentkleur van dit scherm (rand, glow, gekozen optie)
	// en de kop-copy. Alleen vormgeving en tekst — de takken hieronder zijn
	// ongewijzigd.
	const accent = $derived(powerupAccent(powerupType.id, powerupType.category));
	const titleNl = $derived(powerupName(powerupType.id, powerupType.name));

	// Engelse fallback-copy uit de catalogus. Blijft staan voor een type dat nog
	// geen Nederlandse tekst heeft; POWERUP_COPY_NL gaat voor.
	const EFFECT_COPY: Record<string, { action: string; warning?: string }> = {
		bonus_points: {
			action: '+5 points added to your next submission total.'
		},
		single_event_mult: {
			// Pre-activation copy: the multiplier is rolled at activation, so this
			// can only promise the range the card promises — not a number.
			action: 'Random multiplier (×1.2 / ×1.4 / ×1.6) applied to your next challenge final score.'
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
			action: 'Roll the dice — whatever you roll is added to your score immediately.'
		},
		x_ray: {
			action: `Activates ${X_RAY_DEFAULT_BUDGET} reveals. Spend them one answer at a time, on any tab, while you play — a reveal button appears next to every field.`,
			warning: 'A reveal can only be spent during a challenge you have started.'
		},
		free_tab: {
			action: 'Pick one tab — every field of every track on that tab is revealed and filled in.',
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
		},
		lifeline: {
			action:
				'Reveals a masked hint — first letter of every word — for every answer you have not got right yet. You still type them yourself.',
			warning: 'Unlocks halfway through a timed challenge you have started.'
		},
		resurrection: {
			action:
				'Brings one challenge you have already finished back from the dead. You play it again on a THIRD of the original clock, and your score moves by the difference between the two attempts.',
			warning:
				'Only one challenge at a time, and only one go at it — once you submit, it locks again.'
		},
		all_seeing_eye: {
			action:
				'Opens the Eye on every team that has already finished this challenge — you see all of their answers, exactly as they typed them. You are NOT told which of them are right.',
			warning:
				'Needs at least one other team to have finished. If nobody has, the Eye stays in your storage — nothing is spent.'
		}
	};

	// Nederlands waar het bestaat, anders de Engelse catalogustekst hierboven.
	const copy = $derived({
		action:
			powerupDesc(powerupType.id, null) ||
			EFFECT_COPY[powerupType.id]?.action ||
			powerupType.description ||
			'',
		warning: powerupWarn(powerupType.id) ?? EFFECT_COPY[powerupType.id]?.warning ?? null
	});
	const needsFieldPicker = $derived(powerupType.id === 'free_answer');

	// Waar een free_answer-onthulling landt: de tab en de track die de speler op
	// dit moment open heeft. De modal krijgt dat adres al mee (`tabId` +
	// `slotIndex`, dezelfde twee die als hidden input meegaan); dit is puur het
	// leesbaar maken ervan. Het tracknummer alleen als de tab meer dan één track
	// heeft — anders is het ruis.
	const openTab = $derived(revealTabs.find((t) => t.id === tabId));
	const openAddressLabel = $derived(
		[openTab?.label, (openTab?.slotCount ?? 1) > 1 ? `Track ${slotIndex + 1}` : null]
			.filter(Boolean)
			.join(' · ') || 'de track die je nu open hebt'
	);

	// ── free_tab tab picker ───────────────────────────────────────────────────
	//
	// Builds a list of (tab, slot, field) addresses — the SAME address free_answer's
	// single field + tab_id + slot_index form — for every cell of the chosen tab.
	// Nothing is resolved client-side: the addresses go to the server and come back
	// as answers from free_answer's resolver.
	//
	// x_ray has NO picker here any more. Activating it only opens a budget; the
	// choosing happens later, one field at a time, on the challenge page itself.
	const needsTabPicker = $derived(powerupType.id === 'free_tab');

	let selectedTabId = $state('');
	$effect(() => {
		if (needsTabPicker && !selectedTabId) selectedTabId = tabId ?? revealTabs[0]?.id ?? '';
	});
	const selectedTab = $derived(revealTabs.find((t) => t.id === selectedTabId));

	// ── Welke TRACK binnen die tab ────────────────────────────────────────────
	//
	// Gratis Tab onthulde de antwoorden van ÉLKE track op de gekozen tab. Op een
	// fragments-beurt van drie tracks was dat in één klap de hele beurt — te sterk
	// voor één powerup. Nu is het één track.
	//
	// WAAROM EEN EIGEN KIEZER en niet "de track die je nu open hebt": deze powerup
	// mag een tab kiezen waar je NIET op staat (dat is zijn hele bestaansreden —
	// vooruitkijken naar een beurt die nog moet komen). Voor zo'n tab bestaat "de
	// track die je open hebt" niet. Een impliciete keuze zou dus alleen kloppen
	// zolang je de huidige tab kiest, en stilletjes op track 1 uitkomen zodra je
	// dat niet doet. Expliciet kiezen is het enige dat op elke tab hetzelfde
	// betekent — en het past bij het karakter van deze powerup, die al om een
	// keuze vraagt.
	//
	// De kiezer verschijnt alleen als er iets te kiezen valt (slotCount > 1); een
	// tab met één track heeft er geen.
	let selectedSlot = $state(0);
	const slotCount = $derived(Math.max(selectedTab?.slotCount ?? 1, 1));
	// Van tab wisselen zet de trackkeuze terug: slot 3 van een tab met drie tracks
	// bestaat niet op een tab met één.
	$effect(() => {
		void selectedTabId;
		selectedSlot = 0;
	});

	// What actually gets posted. Built here so the "how many answers will this
	// reveal" preview below and the hidden input can never disagree.
	const revealTargets = $derived<RevealTarget[]>(
		needsTabPicker && selectedTab
			? selectedTab.fields.map((f) => ({
					tabId: selectedTab.id,
					slotIndex: Math.min(selectedSlot, slotCount - 1),
					field: f
				}))
			: []
	);
	const targetsMissing = $derived(needsTabPicker && revealTargets.length === 0);
	// double_down asks for a NUMBER rather than a choice from a list — the first
	// powerup to do so. It travels by the same hidden-input mechanism free_answer's
	// field picker uses; only the control differs.
	const needsPrediction = $derived(powerupType.id === 'double_down');
	let predictedPct = $state(50);
	// Both outcomes, from the SAME function the scorer runs ($lib/powerups-meta) —
	// the team sees the exact multipliers it is betting on, not a restated rule.
	const hitMultiplier = $derived(doubleDownMultiplier(predictedPct, 100));
	const missMultiplier = $derived(doubleDownMultiplier(predictedPct, 0));
	// Designbron scherm 4: een balk van gelijke segmenten in plaats van een kale
	// range-input. PUUR WEERGAVE — de balk schrijft dezelfde `predictedPct` als
	// de slider, die eronder blijft staan voor de fijnregeling (1% stappen), dus
	// het team kan nog exact evenveel uitdrukken als eerst.
	const DD_SEGMENTS = 10;
	const ddStep = (DOUBLE_DOWN_MAX_PCT - DOUBLE_DOWN_MIN_PCT) / DD_SEGMENTS;
	const ddSegments = $derived(
		Array.from({ length: DD_SEGMENTS }, (_, i) => {
			const upper = DOUBLE_DOWN_MIN_PCT + (i + 1) * ddStep;
			return { upper, filled: predictedPct >= upper - ddStep / 2 };
		})
	);
	// ── resurrection challenge picker ─────────────────────────────────────────
	//
	// The only picker that chooses a challenge rather than something INSIDE the
	// current one. It defaults to the challenge being looked at when that is one of
	// the options ("or it is the current one"), and otherwise to the first — but the
	// choice is always visible, because spending a Tier S powerup on the wrong
	// challenge is not a mistake a player can undo.
	const needsChallengePicker = $derived(powerupType.id === 'resurrection');
	let selectedResurrectionId = $state('');
	$effect(() => {
		if (!needsChallengePicker || selectedResurrectionId) return;
		const current = resurrectableChallenges.find((c) => c.id === currentChallengeId);
		selectedResurrectionId = current?.id ?? resurrectableChallenges[0]?.id ?? '';
	});
	const selectedResurrection = $derived(
		resurrectableChallenges.find((c) => c.id === selectedResurrectionId)
	);
	// Nothing finished yet → nothing to bring back. Said here rather than letting
	// the click fail server-side: the refusal is identical either way, but a team
	// should not have to spend a click to learn it.
	const resurrectionEmpty = $derived(needsChallengePicker && resurrectableChallenges.length === 0);

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
		['time_boost', 'insurance', 'free_answer', 'free_tab', 'lifeline'].includes(powerupType.id)
	);
	// lifeline posts the team's draft alongside the activation. Everything else the
	// modal sends is a CHOICE the team makes here; this is state that lives on the
	// challenge page, so it is attached in the submit handler rather than bound to a
	// control.
	const sendsDraft = $derived(powerupType.id === 'lifeline');
	const gated = $derived(needsChallenge && !currentChallengeId);
	const targetName = $derived(
		targetTeams.find((t) => t.id === selectedTargetId)?.display_name ?? ''
	);
	// Can't fire a targeted powerup without a chosen target.
	const targetMissing = $derived(needsTarget && !selectedTargetId);

	const handleSubmit: SubmitFunction = ({ formData }) => {
		// Read the draft at submit time, not at render time — see draftSnapshot.
		if (sendsDraft && draftSnapshot) formData.set('lifeline_draft', draftSnapshot());
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
							lifelineHints?: LifelineHint[];
							payload?: Record<string, unknown>;
							blocked?: boolean;
							resurrection?: { challengeId: string };
					  }
					| undefined;
				if (data?.resurrection?.challengeId) {
					// The challenge is open again — send the team straight to it. It is
					// usually NOT the page they are on (the normal activation site is
					// /team), and the short clock is already running, so anything that
					// asks for a second click is spending their retry for them.
					onclose(true);
					await goto(`/challenge/${data.resurrection.challengeId}`, { invalidateAll: true });
				} else if (needsTarget) {
					// Show a caster-side confirmation (blocked vs sent), then close on OK.
					resultState = data?.blocked ? 'blocked' : 'sent';
				} else if (showsRoll && data?.payload) {
					// Hold the modal open on the result instead of closing: the roll IS the
					// feedback. The number comes from the team_effects payload the server
					// actually wrote, not from a client-side re-roll.
					rolled = data.payload as typeof rolled;
					resultState = 'rolled';
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
					// becomes a one-element list; free_tab hands back the list the server
					// already addressed for it (which may be SHORTER than what was asked
					// for — unresolvable cells are skipped server-side, see the free_tab
					// branch in powerups.ts).
					const reveals: RevealResult[] | undefined = data?.reveals?.length
						? data.reveals
						: reveal
							? [reveal]
							: undefined;
					// Hints travel in their own argument, never merged into `reveals`: a
					// reveal gets written into the draft by applyRevealToDraft, and a
					// Lifeline hint must not be. Two channels is what keeps that impossible
					// rather than merely unintended.
					onclose(true, reveals, data?.lifelineHints);
				}
			} else if (result.type === 'failure') {
				const data = result.data as { activateError?: string } | undefined;
				activateError = data?.activateError ?? 'Activation failed';
			}
		};
	};
</script>

<!--
	Redesign fase 4 — schermen 2 (doelkiezer), 3 (veld-/tabkiezer + uitkomsten)
	en 4 (double-down voorspelling).

	PUUR PRESENTATIE. Onveranderd: elke `$derived` hierboven, `handleSubmit`,
	het <form method="POST" action={activateAction}> met exact dezelfde hidden
	inputs (team_powerup_id, current_challenge_id, field, tab_id, slot_index,
	target_team_id, predicted_pct, reveal_targets, resurrection_challenge_id),
	de disabled-voorwaarden op de knop en de drie uitkomststaten
	(sent / blocked / rolled).
-->
<div
	use:portal
	class="fixed inset-0 z-50 flex items-center justify-center p-[18px] mixup-scrim-blur"
	role="dialog"
	aria-modal="true"
	aria-label={titleNl}
>
	<div class="modal-card mixup-panel squircle" style="--accent: {accent};">
		<!-- Kop: icoon + naam + wat het doet -->
		<div class="flex items-center gap-3">
			<img
				src={powerupIcon(powerupType.id)}
				alt=""
				class="h-14 w-14 shrink-0 object-contain"
				onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
			/>
			<div class="min-w-0">
				<div
					class="font-display text-[28px] leading-none font-black text-mixup-paper uppercase"
					style="overflow-wrap: anywhere;"
				>
					{titleNl}
				</div>
				{#if resultState === 'idle'}
					<div class="mt-1 text-xs leading-snug font-medium text-mixup-muted">{copy.action}</div>
				{/if}
			</div>
		</div>

		{#if resultState === 'rolled'}
			<!-- Scherm 3, uitkomst A — lucky_dice: de worp, en de score die hij al
			     verzette. Beide getallen komen uit de payload die de server schreef. -->
			<div class="outcome outcome--green squircle">
				<img src={powerupIcon('lucky_dice')} alt="" class="h-[26px] w-[26px] object-contain" />
				<div class="min-w-0">
					<div class="text-xs font-extrabold tracking-[0.08em] text-mixup-green">
						GEROLD: {rolled.value ?? '?'}
					</div>
					<div class="text-[11px] font-medium text-mixup-muted">
						+{rolled.value ?? 0} punten, direct op je score
						{#if typeof rolled.dice_min === 'number' && typeof rolled.dice_max === 'number'}
							(uit {rolled.dice_min}–{rolled.dice_max})
						{/if}
					</div>
				</div>
			</div>
			{#if typeof rolled.new_score === 'number'}
				<div class="text-center font-display text-[70px] leading-none font-black text-mixup-green">
					{rolled.new_score}
					<span class="font-ui text-[11px] font-bold tracking-[0.16em] text-mixup-muted"
						>TOTAAL</span
					>
				</div>
			{/if}
			<button
				type="button"
				class="mixup-btn w-full mixup-btn-primary"
				onclick={() => onclose(true)}
			>
				Lekker!
			</button>
		{:else if resultState !== 'idle'}
			<!-- Scherm 3, uitkomst B en C — verstuurd of geblokkeerd. -->
			{#if resultState === 'blocked'}
				<div class="outcome outcome--magenta squircle">
					<img src={powerupIcon('shield')} alt="" class="h-[26px] w-[26px] object-contain" />
					<div class="min-w-0">
						<div class="text-xs font-extrabold tracking-[0.08em]" style="color:#FF6FC4;">
							GEBLOKKEERD DOOR HUN SCHILD
						</div>
						<div class="text-[11px] font-medium text-mixup-muted">
							{targetName} had een schild op. De powerup is verbruikt.
						</div>
					</div>
				</div>
			{:else}
				<div class="outcome outcome--cyan squircle">
					<span class="text-[22px] leading-none">📨</span>
					<div class="text-xs font-extrabold tracking-[0.08em]" style="color:#6FE8FF;">
						VERSTUURD NAAR {targetName.toUpperCase()}
					</div>
				</div>
			{/if}
			<button
				type="button"
				class="mixup-btn w-full mixup-btn-primary"
				onclick={() => onclose(true)}
			>
				OK
			</button>
		{:else}
			{#if copy.warning}
				<div class="mixup-warn"><span class="text-[13px]">⚠️</span><span>{copy.warning}</span></div>
			{/if}

			<!-- ── Scherm 2 — doelkiezer ──────────────────────────────────────────
			     De lijst is exact `targetTeams` zoals de aanroeper hem aanlevert en
			     `canTarget()` beslist onveranderd wie aanklikbaar is. Alleen de
			     opmaak van een tegel is nieuw. -->
			{#if needsTarget}
				{#if targetTeams.length === 0}
					<p class="empty squircle">Geen andere teams om op te richten.</p>
				{:else}
					<div class="grid grid-cols-2 gap-2.5">
						{#each targetTeams as t (t.id)}
							{@const targetable = canTarget(t)}
							<button
								type="button"
								class="target squircle"
								class:target--on={selectedTargetId === t.id}
								class:target--off={!targetable}
								disabled={!targetable}
								onclick={() => targetable && (selectedTargetId = t.id)}
							>
								<span class="dot" style="--dot: {teamHex(t.color)};"></span>
								<span class="target-label">{t.display_name}</span>
								<span class="target-sub" style="color: {targetable ? '#2BD97A' : '#5A648C'};">
									{targetable ? 'IN CHALLENGE' : 'NIET BEZIG'}
								</span>
							</button>
						{/each}
					</div>
				{/if}
			{/if}

			<!-- ── Scherm 3 — veldkiezer (free_answer) ───────────────────────────── -->
			{#if needsFieldPicker && revealableFields.length > 0}
				<div class="flex flex-col gap-2.5">
					<span class="section-label">KIES EEN VELD</span>
					<div class="flex gap-2">
						{#each revealableFields as f (f)}
							<button
								type="button"
								class="pick pick--yellow squircle"
								class:pick--on={selectedField === f}
								onclick={() => (selectedField = f)}
							>
								{fieldLabel(f)}
							</button>
						{/each}
					</div>
					<!-- Kort en concreet: het antwoord komt op de plek die je NU open hebt.
					     Zonder deze regel is dat niet te zien — de tab en de track staan
					     achter de modal — en op een fragments-beurt van drie tracks is dat
					     precies het verschil tussen een raak en een verspild antwoord. -->
					<p class="hint">
						Voor {openAddressLabel}. De onthulling wordt écht ingevuld in jullie antwoord.
					</p>
				</div>
			{/if}

			<!-- ── Scherm 3 — tabkiezer (free_tab) ───────────────────────────────── -->
			{#if needsTabPicker}
				<div class="flex flex-col gap-2.5">
					<span class="section-label">KIES EEN TRACK</span>
					{#if revealTabs.length === 0}
						<p class="empty squircle">Deze challenge heeft geen tabs.</p>
					{:else}
						<div class="flex gap-2 overflow-x-auto">
							{#each revealTabs as t (t.id)}
								<button
									type="button"
									class="pick pick--violet squircle"
									class:pick--on={selectedTabId === t.id}
									onclick={() => (selectedTabId = t.id)}
								>
									{t.label}
								</button>
							{/each}
						</div>
						{#if slotCount > 1}
							<!-- Alleen als er iets te kiezen valt. Zie de toelichting bij
							     `selectedSlot`: deze powerup mag een tab kiezen waar je niet op
							     staat, dus "de track die je open hebt" bestaat hier niet. -->
							<span class="section-label">WELKE TRACK OP DIE TAB</span>
							<div class="flex gap-2 overflow-x-auto">
								{#each Array.from({ length: slotCount }, (_, i) => i) as si (si)}
									<button
										type="button"
										class="pick pick--violet squircle"
										class:pick--on={selectedSlot === si}
										onclick={() => (selectedSlot = si)}
									>
										Track {si + 1}
									</button>
								{/each}
							</div>
						{/if}
						{#if revealTargets.length > 0}
							<div class="preview squircle">
								» {selectedTab?.label ?? ''}{#if slotCount > 1}
									· Track {selectedSlot + 1}{/if} ·
								{revealTargets.length}
								{revealTargets.length === 1 ? 'antwoord' : 'antwoorden'} onthuld
							</div>
						{/if}
					{/if}
				</div>
			{/if}

			<!-- ── Challenge-kiezer (resurrection) ───────────────────────────────── -->
			{#if needsChallengePicker}
				<div class="flex flex-col gap-2.5">
					<span class="section-label">WELKE CHALLENGE KOMT TERUG?</span>
					{#if resurrectionEmpty}
						<p class="empty squircle">
							Jullie hebben nog geen challenge afgerond — er is niets om terug te halen. De
							Resurrection blijft in bezit.
						</p>
					{:else}
						<div class="flex flex-col gap-2">
							{#each resurrectableChallenges as c (c.id)}
								<button
									type="button"
									class="row-pick squircle"
									class:row-pick--on={selectedResurrectionId === c.id}
									onclick={() => (selectedResurrectionId = c.id)}
								>
									<span class="truncate">{c.title}</span>
									<span class="shrink-0 text-mixup-yellow">{c.oldFinal} ptn</span>
								</button>
							{/each}
						</div>
						{#if selectedResurrection}
							<div class="preview squircle">
								» {selectedResurrection.retrySeconds !== null
									? `${selectedResurrection.retrySeconds}s om ${selectedResurrection.oldFinal} te verslaan`
									: `geen timer — neem de tijd om ${selectedResurrection.oldFinal} te verslaan`}
							</div>
						{/if}
					{/if}
				</div>
			{/if}

			<!-- ── Scherm 4 — double-down voorspellingsslider ────────────────────── -->
			{#if needsPrediction}
				<div class="flex flex-col gap-3.5">
					<div class="dd-value text-center font-display text-[70px] leading-none font-black">
						{predictedPct}<span class="text-[28px] text-mixup-muted"> %</span>
					</div>
					<div class="flex gap-1.5">
						{#each ddSegments as seg, i (i)}
							<button
								type="button"
								class="dd-step squircle"
								class:dd-step--on={seg.filled}
								aria-label="Voorspel {seg.upper}%"
								onclick={() => (predictedPct = seg.upper)}
							></button>
						{/each}
					</div>
					<!-- De fijnregeling. Blijft staan: de balk hierboven zet hele stappen,
					     dit zet elk percentage — precies wat de invoer eerder al kon. -->
					<input
						id="double-down-pct"
						type="range"
						min={DOUBLE_DOWN_MIN_PCT}
						max={DOUBLE_DOWN_MAX_PCT}
						step="1"
						bind:value={predictedPct}
						aria-label="Jullie voorspelling in procenten"
						class="dd-range"
					/>
					<div class="flex gap-2.5">
						<div class="dd-out dd-out--win squircle">
							<div class="font-display text-[26px] leading-none font-black text-mixup-green">
								×{hitMultiplier.toFixed(2)}
							</div>
							<div class="dd-out-label">BIJ RAAK</div>
						</div>
						<div class="dd-out dd-out--lose squircle">
							<div class="font-display text-[26px] leading-none font-black text-mixup-magenta">
								×{missMultiplier.toFixed(2)}
							</div>
							<div class="dd-out-label">BIJ MIS</div>
						</div>
					</div>
					{#if predictedPct === 0}
						<p class="hint">Op 0% doet de inzet niets — je score verandert hoe dan ook niet.</p>
					{/if}
				</div>
			{/if}

			{#if gated}
				<div
					class="mixup-warn"
					style="border-color: rgba(255,45,170,0.5); background: rgba(255,45,170,0.08); color:#FF6FC4;"
				>
					<span class="text-[13px]">⛔</span>
					<span>Deze powerup werkt alleen tijdens een lopende challenge.</span>
				</div>
			{/if}

			{#if activateError}
				<p class="text-xs font-semibold text-mixup-magenta">{activateError}</p>
			{/if}

			<!-- Actieknoppen. Het <form> en alle hidden inputs zijn ongewijzigd. -->
			<div class="flex gap-2.5">
				{#if !gated}
					<form method="POST" action={activateAction} use:enhance={handleSubmit} class="flex-[1.4]">
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
							<!-- free_tab: the whole address list in one field
							     (parseRevealTargets on the server). -->
							<input type="hidden" name="reveal_targets" value={JSON.stringify(revealTargets)} />
						{/if}
						{#if needsChallengePicker && selectedResurrectionId}
							<!-- resurrection: the challenge to bring back. Always sent, even when
							     it IS the current one — the server's fallback to
							     currentChallengeId exists for callers without a picker. -->
							<input
								type="hidden"
								name="resurrection_challenge_id"
								value={selectedResurrectionId}
							/>
						{/if}
						<button
							type="submit"
							disabled={activating ||
								(needsFieldPicker && !selectedField) ||
								targetMissing ||
								targetsMissing ||
								(needsChallengePicker && !selectedResurrectionId)}
							class="mixup-btn w-full {targetMissing
								? 'mixup-btn-ghost'
								: 'mixup-btn-primary'} disabled:cursor-not-allowed disabled:opacity-50"
						>
							{#if activating}
								Bezig…
							{:else if needsTarget}
								{targetMissing
									? 'Kies eerst een doelwit'
									: `${fireVerb(powerupType.id)} ${targetName}`}
							{:else if needsPrediction}
								Zet in op {predictedPct}%
							{:else}
								Activeer
							{/if}
						</button>
					</form>
				{/if}
				<button
					type="button"
					onclick={() => onclose(false)}
					class="mixup-btn mixup-btn-ghost {gated ? 'flex-1' : 'flex-1 px-4'}"
				>
					{gated ? 'Sluit' : 'Terug'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	/* Designbron: linear-gradient(160deg,#1A1440,#0E0B28), rand + glow in de
	   accentkleur, radius 28, padding 20, kolom met gap 14. */
	.modal-card {
		width: 100%;
		max-width: 400px;
		max-height: 100%;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 20px;
		border-radius: 28px;
		border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
		box-shadow: 0 0 50px color-mix(in srgb, var(--accent) 22%, transparent);
	}

	.section-label {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 10px;
		letter-spacing: 0.16em;
		color: var(--color-mixup-muted);
	}

	.hint {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: 12px;
		color: var(--color-mixup-muted);
	}

	.empty {
		background: rgba(229, 242, 255, 0.05);
		border: 1px solid rgba(229, 242, 255, 0.16);
		border-radius: 16px;
		padding: 10px 12px;
		font-size: 12px;
		font-weight: 500;
		color: var(--color-mixup-dim);
	}

	/* ── Doeltegel (scherm 2) ─────────────────────────────────────────────── */
	.target {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 12px;
		border-radius: 18px;
		min-height: 44px;
		box-sizing: border-box;
		text-align: left;
		background: rgba(229, 242, 255, 0.05);
		border: 1px solid rgba(229, 242, 255, 0.16);
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.target--on {
		background: linear-gradient(135deg, rgba(0, 229, 255, 0.2), rgba(124, 77, 255, 0.2));
		border-color: rgba(0, 229, 255, 0.7);
		box-shadow: 0 0 18px rgba(0, 229, 255, 0.3);
	}

	.target--off {
		opacity: 0.4;
		cursor: default;
	}

	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex: 0 0 auto;
		background: var(--dot);
		border: 1px solid rgba(229, 242, 255, 0.5);
		box-shadow: 0 0 8px var(--dot);
	}

	.target-label {
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 12px;
		letter-spacing: 0.06em;
		color: var(--color-mixup-paper);
	}

	.target-sub {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 9px;
		letter-spacing: 0.1em;
	}

	/* ── Keuzeknoppen (scherm 3) ──────────────────────────────────────────── */
	.pick {
		flex: 1 0 auto;
		height: 44px;
		padding: 0 10px;
		border-radius: 24px;
		font-family: var(--font-ui);
		font-weight: 800;
		font-size: 12px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
		background: rgba(229, 242, 255, 0.05);
		border: 1px solid rgba(229, 242, 255, 0.16);
		color: var(--color-mixup-muted);
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
	}

	.pick--yellow.pick--on {
		background: rgba(255, 230, 0, 0.12);
		border-color: var(--color-mixup-yellow);
		color: var(--color-mixup-yellow);
	}

	.pick--violet.pick--on {
		background: rgba(124, 77, 255, 0.25);
		border-color: rgba(124, 77, 255, 0.8);
		color: #c9b3ff;
	}

	.row-pick {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 44px;
		padding: 10px 14px;
		border-radius: 16px;
		text-align: left;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 13px;
		background: rgba(229, 242, 255, 0.05);
		border: 1px solid rgba(229, 242, 255, 0.16);
		color: var(--color-mixup-muted);
	}

	.row-pick--on {
		background: rgba(124, 77, 255, 0.25);
		border-color: rgba(124, 77, 255, 0.8);
		color: var(--color-mixup-paper);
	}

	.preview {
		background: rgba(11, 11, 31, 0.62);
		border: 1px solid rgba(229, 242, 255, 0.18);
		border-radius: 14px;
		padding: 10px 12px;
		font-family: var(--font-data);
		font-size: 12px;
		color: #6fe8ff;
	}

	/* ── Uitkomsten (scherm 3) ────────────────────────────────────────────── */
	.outcome {
		display: flex;
		align-items: center;
		gap: 10px;
		border-radius: 18px;
		padding: 12px 14px;
	}

	.outcome--green {
		background: rgba(43, 217, 122, 0.08);
		border: 1px solid rgba(43, 217, 122, 0.5);
	}

	.outcome--cyan {
		background: rgba(0, 229, 255, 0.06);
		border: 1px solid rgba(0, 229, 255, 0.4);
	}

	.outcome--magenta {
		background: rgba(255, 45, 170, 0.07);
		border: 1px solid rgba(255, 45, 170, 0.45);
	}

	/* ── Double down (scherm 4) ───────────────────────────────────────────── */
	.dd-value {
		color: #ff6fc4;
		text-shadow: 0 0 30px rgba(255, 45, 170, 0.5);
	}

	.dd-step {
		flex: 1;
		height: 44px;
		border-radius: 10px;
		border: none;
		background: rgba(229, 242, 255, 0.08);
		transition:
			background 0.15s ease,
			box-shadow 0.15s ease;
	}

	.dd-step--on {
		background: linear-gradient(180deg, #ff6fc4, #ff2daa);
		box-shadow: 0 0 10px rgba(255, 45, 170, 0.4);
	}

	.dd-range {
		width: 100%;
		accent-color: #ff2daa;
	}

	.dd-out {
		flex: 1;
		border-radius: 16px;
		padding: 12px;
		text-align: center;
	}

	.dd-out--win {
		background: rgba(43, 217, 122, 0.08);
		border: 1px solid rgba(43, 217, 122, 0.5);
	}

	.dd-out--lose {
		background: rgba(255, 45, 170, 0.07);
		border: 1px solid rgba(255, 45, 170, 0.45);
	}

	.dd-out-label {
		margin-top: 2px;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 9px;
		letter-spacing: 0.1em;
		color: var(--color-mixup-muted);
	}
</style>
