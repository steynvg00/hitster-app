<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { getTypeIcon, getTypeColor, CHALLENGE_TYPES } from '$lib/variants';
	import StandardEditor from '$lib/components/admin/challenge-editors/StandardEditor.svelte';
	import MashupEditor from '$lib/components/admin/challenge-editors/MashupEditor.svelte';
	import FragmentsEditor from '$lib/components/admin/challenge-editors/FragmentsEditor.svelte';
	import EffectsEditor from '$lib/components/admin/challenge-editors/EffectsEditor.svelte';
	import FieldsEditor from '$lib/components/admin/challenge-editors/FieldsEditor.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const STATUS_OPTIONS = ['draft', 'active', 'completed'] as const;

	const TYPE_LABELS: Record<string, string> = {
		standard: 'Standard',
		anthem: 'Anthem',
		label: 'Label',
		mashup: 'Mashup',
		fragments: 'Fragments',
		effects: 'Effects'
	};

	// Difficulty star state
	let difficulty = $state(
		(data.challenge as unknown as { difficulty_rating?: number }).difficulty_rating ?? 3
	);

	// No-timer toggle
	let noTimer = $state(data.challenge.timer_seconds == null);

	// NFC lock override tri-state
	type NfcOverride = 'inherit' | 'true' | 'false';
	const nfcOverrideRaw = (data.challenge as unknown as { nfc_lock_override?: boolean | null })
		.nfc_lock_override;
	let nfcOverride = $state<NfcOverride>(
		nfcOverrideRaw === true ? 'true' : nfcOverrideRaw === false ? 'false' : 'inherit'
	);

	const VariantIcon = $derived(getTypeIcon(data.challenge.variant));
	const variantColor = $derived(getTypeColor(data.challenge.variant));

	const isStandardLike = $derived(
		data.challenge.variant === 'standard' ||
			data.challenge.variant === 'anthem' ||
			data.challenge.variant === 'label'
	);
	const isMashup = $derived(data.challenge.variant === 'mashup');
	const isFragments = $derived(data.challenge.variant === 'fragments');
	const isEffects = $derived(data.challenge.variant === 'effects');

	const statusColor: Record<string, string> = {
		draft: 'text-zinc-400 bg-zinc-800',
		active: 'text-green-400 bg-green-900/40',
		completed: 'text-blue-400 bg-blue-900/40'
	};
</script>

<div class="mx-auto max-w-4xl p-6">
	<!-- Header -->
	<div class="mb-6 flex items-start justify-between gap-4">
		<div class="flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-xl {variantColor}">
				<svelte:component this={VariantIcon} size={20} />
			</div>
			<div>
				<h1 class="text-xl font-black text-white">{data.challenge.title}</h1>
				<div class="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
					<span>{TYPE_LABELS[data.challenge.variant] ?? data.challenge.variant}</span>
					<span>·</span>
					<span class="rounded px-2 py-0.5 {statusColor[data.challenge.status] ?? 'text-zinc-400'}">
						{data.challenge.status}
					</span>
				</div>
			</div>
		</div>

		<div class="flex gap-2">
			<form method="POST" action="?/duplicateChallenge" use:enhance>
				<button
					type="submit"
					class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
				>
					Duplicate
				</button>
			</form>
			<a
				href="/admin/challenges"
				class="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:text-zinc-200"
			>
				← Back
			</a>
		</div>
	</div>

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}
	{#if form?.success && form.action !== 'addTab' && form.action !== 'removeTab'}
		<div
			class="mb-4 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300"
		>
			Saved
		</div>
	{/if}

	<!-- ── Meta form ── -->
	<section class="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="mb-4 text-sm font-bold tracking-widest text-amber-400 uppercase">Details</h2>
		<form
			method="POST"
			action="?/updateMeta"
			use:enhance={() => async ({ update }) => update({ reset: false })}
			class="space-y-3"
		>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Title</label>
					<input name="title" value={data.challenge.title} required class="input-field" />
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Stage label</label>
					<input name="stage_label" value={data.challenge.stage_label ?? ''} class="input-field" />
				</div>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Type</label>
					<select name="variant" class="input-field">
						{#each CHALLENGE_TYPES as t (t)}
							<option value={t} selected={data.challenge.variant === t}>{TYPE_LABELS[t]}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Timer (seconds)</label>
					<div class="flex items-center gap-2">
						{#if noTimer}
							<input type="text" disabled value="–" class="input-field flex-1 disabled:opacity-40" />
						{:else}
							<input
								name="timer_seconds"
								type="number"
								value={data.challenge.timer_seconds ?? 60}
								min="10"
								max="600"
								placeholder="60"
								class="input-field flex-1"
							/>
						{/if}
						<label class="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
							<input
								type="checkbox"
								bind:checked={noTimer}
								class="h-3.5 w-3.5 rounded accent-amber-400"
							/>
							No timer
						</label>
					</div>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Difficulty (1–5)</label>
					<div class="flex gap-1">
						{#each [1, 2, 3, 4, 5] as star}
							<button
								type="button"
								onclick={() => (difficulty = star)}
								class="text-xl transition-colors {star <= difficulty
									? 'text-amber-400'
									: 'text-zinc-700'}"
								aria-label="Difficulty {star}">★</button
							>
						{/each}
					</div>
					<input type="hidden" name="difficulty_rating" value={difficulty} />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Speed bonus threshold (sec)</label>
					<input
						name="speed_threshold_seconds"
						type="number"
						value={(data.challenge as unknown as { speed_threshold_seconds?: number | null })
							.speed_threshold_seconds ?? ''}
						placeholder="none"
						class="input-field"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400">NFC lock override</label>
					<select name="nfc_lock_override" bind:value={nfcOverride} class="input-field">
						<option value="inherit">Inherit from set</option>
						<option value="true">Force lock ON</option>
						<option value="false">Force lock OFF</option>
					</select>
				</div>
			</div>
			<div>
				<label class="mb-1 block text-xs text-zinc-400">Hint text (optional)</label>
				<textarea
					name="hint_text"
					rows="2"
					class="input-field"
					placeholder="Shown when team scans the hint NFC sticker"
					>{(data.challenge as unknown as { hint_text?: string | null }).hint_text ?? ''}</textarea
				>
			</div>
			<div class="flex justify-end">
				<button type="submit" class="btn-primary">Save details</button>
			</div>
		</form>
	</section>

	<!-- ── Status ── -->
	<section class="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="mb-3 text-sm font-bold tracking-widest text-amber-400 uppercase">Status</h2>
		<form method="POST" action="?/setStatus" use:enhance class="flex gap-2">
			{#each STATUS_OPTIONS as s (s)}
				<button
					type="submit"
					name="status"
					value={s}
					class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors
						{data.challenge.status === s
						? 'bg-amber-400 text-zinc-950'
						: 'border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'}"
				>
					{s}
				</button>
			{/each}
		</form>
	</section>

	<!-- ── Type-aware editor ── -->
	<div class="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="mb-4 text-sm font-bold tracking-widest text-amber-400 uppercase">
			{TYPE_LABELS[data.challenge.variant] ?? data.challenge.variant} Editor
		</h2>

		{#if isStandardLike}
			<StandardEditor
				tabs={data.tabs}
				sourceTracksByTab={data.sourceTracksByTab}
				clipsByTab={data.clipsByTab}
				allTracks={data.allTracks}
				clips={data.clips}
			/>
		{:else if isMashup}
			<MashupEditor
				tabs={data.tabs}
				mashups={data.mashups}
				mashupSources={data.mashupSources}
				allTracks={data.allTracks}
				clips={data.clips}
			/>
		{:else if isFragments}
			<FragmentsEditor tabs={data.tabs} clipsByTab={data.clipsByTab} allTracks={data.allTracks} clips={data.clips} />
		{:else if isEffects}
			<EffectsEditor
				tabs={data.tabs}
				sourceTracksByTab={data.sourceTracksByTab}
				clipsByTab={data.clipsByTab}
				allTracks={data.allTracks}
				clips={data.clips}
				userPresets={(data as unknown as { userPresets?: import('$lib/types/index.js').EffectPreset[] }).userPresets ?? []}
			/>
		{/if}
	</div>

	<!-- ── Answer fields (configurable, variant-agnostic) ── -->
	<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<FieldsEditor
			resolvedFields={data.resolvedFields}
			poolBackedFields={data.poolBackedFields}
			answerOptions={data.answerOptions}
		/>
	</div>
</div>

<style>
	:global(.input-field) {
		background: #27272a;
		border: 1px solid #3f3f46;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
		color: #f4f4f5;
		font-size: 0.875rem;
		width: 100%;
		transition: border-color 0.15s;
	}
	:global(.input-field:focus) {
		outline: none;
		border-color: #fbbf24;
	}
	:global(.btn-primary) {
		background: #fbbf24;
		color: #09090b;
		font-weight: 700;
		padding: 0.4rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		transition: background 0.15s;
	}
	:global(.btn-primary:hover) {
		background: #fcd34d;
	}
	:global(.btn-ghost) {
		background: transparent;
		border: 1px solid #3f3f46;
		color: #a1a1aa;
		font-weight: 500;
		padding: 0.4rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		transition: all 0.15s;
	}
	:global(.btn-ghost:hover) {
		border-color: #71717a;
		color: #f4f4f5;
	}
</style>
