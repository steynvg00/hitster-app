<script lang="ts">
	import { enhance } from '$app/forms';

	type PowerupType = {
		id: string;
		name: string;
		icon: string | null;
		description: string | null;
		holdable: boolean;
		immediate_use: boolean;
	};

	let {
		teamPowerupId,
		type: powerupType,
		onclose
	}: {
		teamPowerupId: string;
		type: PowerupType;
		onclose: () => void;
	} = $props();

	// Slot-machine animation: cycle through random icons for 2 seconds then settle
	const ICONS = ['🎲', '⚡', '🛡️', '🔥', '💡', '✨', '⏱️', '🪙', '🎯', '🌀'];

	let displayIcon = $state(ICONS[0]);
	let settled = $state(false);
	let resolving = $state(false);

	// Start animation immediately on mount
	let animFrame: number;
	let startTime = 0;
	const DURATION_MS = 1800;

	function animate(ts: number) {
		if (!startTime) startTime = ts;
		const elapsed = ts - startTime;

		if (elapsed < DURATION_MS) {
			// Cycle speed slows down as we approach the end
			const progress = elapsed / DURATION_MS;
			const interval = 60 + progress * 200; // 60ms → 260ms
			const idx = Math.floor(elapsed / interval) % ICONS.length;
			displayIcon = ICONS[idx];
			animFrame = requestAnimationFrame(animate);
		} else {
			displayIcon = powerupType.icon ?? '✦';
			settled = true;
		}
	}

	$effect(() => {
		animFrame = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animFrame);
	});
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm p-4"
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
					{settled ? 'border-amber-400 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.3)]' : 'border-zinc-600 bg-zinc-800'}"
			>
				<span class="text-4xl leading-none" class:animate-spin-slow={!settled}>{displayIcon}</span>
			</div>
		</div>

		{#if settled}
			<!-- Name + description -->
			<p class="mb-1 text-center text-lg font-black text-white">{powerupType.name}</p>
			{#if powerupType.description}
				<p class="mb-6 text-center text-sm text-zinc-400">{powerupType.description}</p>
			{:else}
				<div class="mb-6"></div>
			{/if}

			<!-- Action buttons -->
			{#if powerupType.holdable && !powerupType.immediate_use}
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
				<!-- Immediate-use powerup: can only lose in this phase -->
				<p class="mb-4 text-center text-xs text-zinc-500">Activation in next update</p>
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
				>
					<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
					<input type="hidden" name="choice" value="lose" />
					<button
						type="submit"
						disabled={resolving}
						class="w-full rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-50"
					>
						Dismiss
					</button>
				</form>
			{/if}
		{:else}
			<!-- Still animating -->
			<div class="flex justify-center">
				<div class="h-8 w-32 animate-pulse rounded bg-zinc-800"></div>
			</div>
		{/if}
	</div>
</div>

<style>
	@keyframes spin-slow {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
	.animate-spin-slow {
		animation: spin-slow 0.4s linear infinite;
	}
</style>
