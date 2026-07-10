<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';

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
		onclose,
		currentChallengeId,
		variantFields = []
	}: {
		teamPowerupId: string;
		type: PowerupType;
		onclose: (activated?: boolean, revealedValue?: string, revealedField?: string) => void;
		currentChallengeId?: string;
		variantFields?: string[];
	} = $props();

	let activating = $state(false);
	let activateError = $state('');
	let selectedField = $state(variantFields[0] ?? '');

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
			action: 'Shield activated — ready to block one attack. (Dormant: no active attacks yet.)'
		},
		time_boost: {
			action: '+30 seconds added to the current challenge timer.',
			warning: 'Requires an active timed challenge.'
		},
		insurance: {
			action: 'Insurance activated — if your base score is below 50% of max, it will be floored to 50%.',
			warning: 'Will be consumed when you submit this challenge.'
		},
		free_answer: {
			action: 'One field will be revealed for you. Choose which field to unlock.',
			warning: 'Requires an active challenge.'
		}
	};

	const copy = $derived(EFFECT_COPY[powerupType.id] ?? { action: powerupType.description ?? '' });
	const needsFieldPicker = $derived(powerupType.id === 'free_answer');
	const needsChallenge = $derived(
		['time_boost', 'insurance', 'free_answer'].includes(powerupType.id)
	);
	const gated = $derived(needsChallenge && !currentChallengeId);

	const handleSubmit: SubmitFunction = () => {
		activating = true;
		activateError = '';
		return async ({ result, update }) => {
			await update({ reset: false });
			activating = false;
			if (result.type === 'success') {
				const data = result.data as { activated?: boolean; revealedValue?: string } | undefined;
				onclose(true, data?.revealedValue, needsFieldPicker ? selectedField : undefined);
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

		<!-- Effect description -->
		<div class="mb-4 rounded-xl border border-zinc-700 bg-zinc-800/60 p-3">
			<p class="text-sm text-zinc-300">{copy.action}</p>
			{#if copy.warning}
				<p class="mt-1.5 text-xs text-amber-400/80">{copy.warning}</p>
			{/if}
		</div>

		<!-- Field picker for free_answer -->
		{#if needsFieldPicker && variantFields.length > 0}
			<div class="mb-4">
				<label class="mb-1.5 block text-xs font-semibold text-zinc-400">Choose field to reveal</label>
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
				<form
					method="POST"
					action="?/activatePowerup"
					use:enhance={handleSubmit}
					class="flex-1"
				>
					<input type="hidden" name="team_powerup_id" value={teamPowerupId} />
					{#if currentChallengeId}
						<input type="hidden" name="current_challenge_id" value={currentChallengeId} />
					{/if}
					{#if needsFieldPicker && selectedField}
						<input type="hidden" name="field" value={selectedField} />
					{/if}
					<button
						type="submit"
						disabled={activating || (needsFieldPicker && !selectedField)}
						class="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
					>
						{activating ? 'Activating…' : 'Activate'}
					</button>
				</form>
			{/if}
			<button
				type="button"
				onclick={() => onclose(false)}
				class="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white {gated ? 'flex-1' : ''}"
			>
				Cancel
			</button>
		</div>
	</div>
</div>
