<script lang="ts">
	import { enhance } from '$app/forms';
	import { isTargetedPowerup } from '$lib/powerups-meta';
	import PowerupActivationModal from './PowerupActivationModal.svelte';

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

	type Activation = { success: boolean; payload?: Record<string, unknown> };

	let {
		teamPowerupId,
		type: powerupType,
		activation,
		onclose,
		teamId,
		setTeams = [],
		skipRollAnimation = false
	}: {
		teamPowerupId: string;
		type: PowerupType;
		activation?: Activation;
		onclose: () => void;
		// Needed only for the "Use now" path (a holdable, targeted type — give_a_shot
		// today, structurally any future one) — the target-team picker excludes the
		// caster's own team from setTeams.
		teamId?: string;
		setTeams?: TargetTeam[];
		// Render the settled state straight away, no slot machine. Set for a powerup
		// that arrives as the PRIZE of a Power Spin: the spin's own wheel already
		// rolled and landed on it, so rolling a second time for a result the player
		// just watched appear is noise. A powerup earned the normal way never passes
		// this, so its reveal is unchanged.
		skipRollAnimation?: boolean;
	} = $props();

	// A holdable type that ALSO acts on another team gets a third earn-time choice
	// (Use now / Store / Lose) instead of the plain Store/Lose pair. Gated on the
	// same predicate PowerupActivationModal uses for its target picker — not a
	// hardcoded id — so any future holdable offensive type picks this up for free.
	const isHoldableTargeted = $derived(
		powerupType.holdable && !powerupType.immediate_use && isTargetedPowerup(powerupType.id)
	);
	const targetTeams = $derived((setTeams ?? []).filter((t) => t.id !== teamId));

	// "Use now" swaps this modal's card for PowerupActivationModal's target-picker +
	// activation flow, reusing that exact component (and its idle/sent/blocked
	// states) rather than re-implementing a second picker. It posts to a
	// pending-specific action (the powerup is still 'pending' at reveal time, not
	// yet 'held') that shares activatePowerup()'s targeting/shield-block path.
	let usingNow = $state(false);

	// Immediate-use effects are already applied by the time this modal shows —
	// build a concrete confirmation string from the actual team_effects payload
	// rather than the generic catalog description.
	function appliedEffectText(): string {
		if (activation && !activation.success) return "Couldn't apply automatically — sorry!";
		const payload = activation?.payload ?? {};
		switch (powerupType.id) {
			case 'bonus_points':
				return `+${payload.value ?? 15} bonus points banked for your next challenge!`;
			case 'lucky_dice':
				// The rolled number is the whole point of this powerup — show it, and the
				// range it came out of, straight from the payload the server wrote. The
				// points are ALREADY on the board (activatePowerup writes teams.score
				// directly), so this says so rather than promising a future bonus.
				return `🎲 You rolled ${payload.value ?? '?'} (out of ${payload.dice_min ?? 1}–${payload.dice_max ?? 6}) — ${payload.value ?? 0} points added to your score right now${
					typeof payload.new_score === 'number' ? ` (${payload.new_score} total)` : ''
				}!`;
			case 'hard_gaan':
				return `×${payload.multiplier ?? 1.5} on challenge points for the next ${payload.window_minutes ?? 15} minutes!`;
			case 'single_event_mult':
				return `×${payload.multiplier ?? 1.5} on your next challenge!`;
			case 'penalty_shot':
				return 'You scored low — penalty shot! 🥃 Bottoms up.';
			case 'power_spin':
				// The rolled powerup's NAME and ICON are no longer said here — the slot
				// machine settles on them (see spinOutcome / settleIcon below), which is
				// what makes the animation the reveal instead of decoration in front of
				// one. This line is the caption underneath, so it must not repeat the
				// name the title already shows.
				return payload.rolled_type_id
					? "Won on the Power Spin — it's yours!"
					: 'The wheel came up empty — no powerups were available to win. Unlucky!';
			default:
				return powerupType.description ?? 'Effect applied!';
		}
	}

	// ── power_spin: what the wheel landed on ─────────────────────────────────
	//
	// Read from the payload the server already wrote. The ROLL itself is entirely
	// server-side (activatePowerup's power_spin branch) and is not touched here —
	// this only decides WHEN the outcome becomes visible.
	//
	// Before: the slot machine settled on Power Spin's OWN icon (🎡), which reveals
	// nothing, and the outcome arrived as a line of text that popped in at the same
	// instant. The animation had no payoff and the reveal had no moment.
	// Now: the machine settles ON the rolled powerup, so stopping IS the reveal.
	//
	// null for every other powerup, which keeps their behaviour byte-identical.
	const spinOutcome = $derived.by(() => {
		if (powerupType.id !== 'power_spin') return null;
		const p = activation?.payload ?? {};
		if (!p.rolled_type_id) return { empty: true, name: '', icon: '🎡' };
		return {
			empty: false,
			name: typeof p.rolled_type_name === 'string' ? p.rolled_type_name : 'a powerup',
			icon: typeof p.rolled_type_icon === 'string' ? p.rolled_type_icon : '✦'
		};
	});

	// Slot-machine animation: cycle through random icons for 2 seconds then settle.
	// penalty_shot is a spontaneous social popup, not a prize roll — skip the roll
	// and render the settled state immediately. skipRollAnimation does the same for
	// a powerup handed over as a Power Spin prize (its wheel already rolled).
	const ICONS = ['🎲', '⚡', '🛡️', '🔥', '💡', '✨', '⏱️', '🪙', '🎯', '🌀'];

	// Read once, on purpose. The challenge page keys this modal on teamPowerupId, so
	// a new queue entry REMOUNTS it rather than swapping props on a live instance —
	// which makes the roll flags below fixed facts about this card, not signals.
	// Destructured in one go so the whole block costs a single non-reactive read.
	const { id: typeId, icon: ownIcon } = powerupType;
	const animate = typeId !== 'penalty_shot' && !skipRollAnimation;

	// Power Spin is the one powerup whose roll is a MOMENT rather than a transition,
	// so it does not auto-run: the card opens on a Spin button and the wheel turns
	// when the player pulls it. Every other powerup keeps the old behaviour of
	// starting on mount.
	const isSpin = typeId === 'power_spin';
	const autoRoll = animate && !isSpin;

	// What the machine comes to rest on. For a spin that is the PRIZE; for
	// everything else it is the powerup's own icon, exactly as before.
	const settleIcon = $derived(spinOutcome ? spinOutcome.icon : (powerupType.icon ?? '✦'));

	// At rest a spin shows its OWN icon (🎡) — the wheel, not yet turned. Never the
	// prize: nothing about the outcome may exist on screen before the pull.
	let displayIcon = $state(autoRoll ? ICONS[0] : (ownIcon ?? '✦'));
	let settled = $state(!animate);
	let rollStarted = $state(autoRoll);
	let resolving = $state(false);

	function startSpin() {
		if (rollStarted) return; // one pull per card
		rollStarted = true;
	}

	let animFrame: number;
	let startTime = 0;
	const DURATION_MS = 1800;

	function runAnimation(ts: number) {
		if (!startTime) startTime = ts;
		const elapsed = ts - startTime;

		if (elapsed < DURATION_MS) {
			// Cycle speed slows down as we approach the end
			const progress = elapsed / DURATION_MS;
			const interval = 60 + progress * 200; // 60ms → 260ms
			const idx = Math.floor(elapsed / interval) % ICONS.length;
			displayIcon = ICONS[idx];
			animFrame = requestAnimationFrame(runAnimation);
		} else {
			// The settle. For a spin this is the reveal moment: the wheel stops on the
			// powerup that was won, and only then does the name below appear.
			displayIcon = settleIcon;
			settled = true;
		}
	}

	// Gated on rollStarted, not on mount. For everything except a spin that is true
	// from the start, so the effect fires on the first run exactly as it used to;
	// for a spin it fires when startSpin() flips it, which is the whole gate.
	$effect(() => {
		if (!animate || !rollStarted) return;
		animFrame = requestAnimationFrame(runAnimation);
		return () => cancelAnimationFrame(animFrame);
	});
</script>

{#if usingNow}
	<!-- "Use now": reuse PowerupActivationModal's exact target-picker + activation
	     flow, pointed at the pending-specific action instead of the held one. -->
	<PowerupActivationModal
		{teamPowerupId}
		type={powerupType}
		{targetTeams}
		activateAction="?/useNowEarnedPowerup"
		onclose={(activated) => {
			if (activated) {
				onclose();
			} else {
				// Cancel from the picker → back to the Use now / Store / Lose choice.
				usingNow = false;
			}
		}}
	/>
{:else}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div class="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
			<!-- Header. A spin narrates the three states WITHOUT naming what was won,
			     so the wheel below stays the only thing that can reveal it. -->
			<p class="mb-5 text-center text-xs font-bold tracking-widest text-amber-400 uppercase">
				{#if isSpin && !rollStarted}
					Powerup Earned!
				{:else if isSpin && !settled}
					Spinning the wheel…
				{:else if isSpin}
					Power Spin — you won
				{:else}
					Powerup Earned!
				{/if}
			</p>

			<!-- Slot machine / settled icon -->
			<div class="mb-4 flex justify-center">
				<div
					class="flex h-20 w-20 items-center justify-center rounded-2xl border-2 transition-all duration-300
						{settled
						? 'border-amber-400 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.3)]'
						: 'border-zinc-600 bg-zinc-800'}"
				>
					<!-- Spins only while the machine is actually running. A Power Spin
					     sitting on its gate shows a still 🎡, not a wheel already turning. -->
					<span class="text-4xl leading-none" class:animate-spin-slow={rollStarted && !settled}
						>{displayIcon}</span
					>
				</div>
			</div>

			{#if settled}
				<!-- Name. On a spin the prize is the headline, not "Power Spin" — the
				     card is announcing what was won, and the header above already says
				     where it came from. An empty wheel falls back to "Power Spin". -->
				<p class="mb-1 text-center text-lg font-black text-white">
					{spinOutcome && !spinOutcome.empty ? spinOutcome.name : powerupType.name}
				</p>
				{#if powerupType.description && !powerupType.immediate_use}
					<p class="mb-6 text-center text-sm text-zinc-400">{powerupType.description}</p>
				{:else}
					<div class="mb-6"></div>
				{/if}

				<!-- Action buttons -->
				{#if isHoldableTargeted}
					<!-- Holdable + targeted (give_a_shot): a third choice — fire now with a target. -->
					<div class="flex flex-col gap-2">
						<button
							type="button"
							onclick={() => (usingNow = true)}
							class="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
						>
							Use now
						</button>
						<div class="flex gap-3">
							<form
								method="POST"
								action="?/resolveEarnedPowerup"
								use:enhance={() => {
									resolving = true;
									return async ({ update }) => {
										await update();
										onclose();
									};
								}}
								class="flex-1"
							>
								<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
								<input type="hidden" name="choice" value="store" />
								<button
									type="submit"
									disabled={resolving}
									class="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-50"
								>
									Store
								</button>
							</form>
							<form
								method="POST"
								action="?/resolveEarnedPowerup"
								use:enhance={() => {
									resolving = true;
									return async ({ update }) => {
										await update();
										onclose();
									};
								}}
								class="flex-1"
							>
								<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
								<input type="hidden" name="choice" value="lose" />
								<button
									type="submit"
									disabled={resolving}
									class="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-50"
								>
									Lose
								</button>
							</form>
						</div>
					</div>
				{:else if powerupType.holdable && !powerupType.immediate_use}
					<!-- Holdable: store or lose -->
					<div class="flex gap-3">
						<form
							method="POST"
							action="?/resolveEarnedPowerup"
							use:enhance={() => {
								resolving = true;
								return async ({ update }) => {
									await update();
									onclose();
								};
							}}
							class="flex-1"
						>
							<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
							<input type="hidden" name="choice" value="store" />
							<button
								type="submit"
								disabled={resolving}
								class="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
							>
								Send to Storage
							</button>
						</form>
						<form
							method="POST"
							action="?/resolveEarnedPowerup"
							use:enhance={() => {
								resolving = true;
								return async ({ update }) => {
									await update();
									onclose();
								};
							}}
							class="flex-1"
						>
							<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
							<input type="hidden" name="choice" value="lose" />
							<button
								type="submit"
								disabled={resolving}
								class="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-50"
							>
								Lose
							</button>
						</form>
					</div>
				{:else}
					<!-- Immediate-use powerup: already auto-activated, this is just a confirmation -->
					<p class="mb-6 text-center text-sm font-semibold text-amber-300">{appliedEffectText()}</p>
					<button
						type="button"
						onclick={onclose}
						class="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
					>
						Nice!
					</button>
				{/if}
			{:else if isSpin && !rollStarted}
				<!-- STATE 1 — the gate. Power Spin has been won and nothing else has
				     happened yet: no wheel turning, and NOTHING about the outcome in the
				     DOM. spinOutcome is read nowhere in this branch, and the settled
				     block above (which is where the prize's name and icon live) is not
				     rendered at all, so there is nothing to read out of the source
				     either. The pull below is what starts the one and only animation. -->
				<p class="mb-1 text-center text-lg font-black text-white">{powerupType.name}</p>
				<p class="mb-6 text-center text-sm text-zinc-400">
					Pull the wheel to see which powerup you have won.
				</p>
				<button
					type="button"
					onclick={startSpin}
					class="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
				>
					Spin
				</button>
			{:else}
				<!-- STATE 2 — the wheel is turning. Same skeleton every other powerup
				     uses while its slot machine runs. -->
				<div class="flex justify-center">
					<div class="h-8 w-32 animate-pulse rounded bg-zinc-800"></div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	@keyframes spin-slow {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.animate-spin-slow {
		animation: spin-slow 0.4s linear infinite;
	}
</style>
