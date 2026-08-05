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
		setTeams = []
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
				// range it came out of, straight from the payload the server wrote.
				return `🎲 You rolled ${payload.value ?? '?'} (out of ${payload.dice_min ?? 1}–${payload.dice_max ?? 6}) — +${payload.value ?? 0} bonus points on your next submission!`;
			case 'hard_gaan':
				return `×${payload.multiplier ?? 1.5} on challenge points for the next ${payload.window_minutes ?? 15} minutes!`;
			case 'single_event_mult':
				return `×${payload.multiplier ?? 1.5} on your next challenge!`;
			case 'penalty_shot':
				return 'You scored low — penalty shot! 🥃 Bottoms up.';
			default:
				return powerupType.description ?? 'Effect applied!';
		}
	}

	// Slot-machine animation: cycle through random icons for 2 seconds then settle.
	// penalty_shot is a spontaneous social popup, not a prize roll — skip the roll
	// and render the settled state immediately.
	const ICONS = ['🎲', '⚡', '🛡️', '🔥', '💡', '✨', '⏱️', '🪙', '🎯', '🌀'];
	const animate = powerupType.id !== 'penalty_shot';

	let displayIcon = $state(animate ? ICONS[0] : (powerupType.icon ?? '✦'));
	let settled = $state(!animate);
	let resolving = $state(false);

	// Start animation immediately on mount
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
			displayIcon = powerupType.icon ?? '✦';
			settled = true;
		}
	}

	$effect(() => {
		if (!animate) return;
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
			<!-- Header -->
			<p class="mb-5 text-center text-xs font-bold tracking-widest text-amber-400 uppercase">
				Powerup Earned!
			</p>

			<!-- Slot machine / settled icon -->
			<div class="mb-4 flex justify-center">
				<div
					class="flex h-20 w-20 items-center justify-center rounded-2xl border-2 transition-all duration-300
						{settled
						? 'border-amber-400 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.3)]'
						: 'border-zinc-600 bg-zinc-800'}"
				>
					<span class="text-4xl leading-none" class:animate-spin-slow={!settled}>{displayIcon}</span
					>
				</div>
			</div>

			{#if settled}
				<!-- Name + description -->
				<p class="mb-1 text-center text-lg font-black text-white">{powerupType.name}</p>
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
			{:else}
				<!-- Still animating -->
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
