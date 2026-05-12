<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { getVariantIcon, getVariantColor } from '$lib/variants';
	import HelpTooltip from '$lib/components/ui/HelpTooltip.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const VARIANTS = [
		'normal',
		'label',
		'anthem',
		'vocal',
		'fragments',
		'kick',
		'mashup',
		'battle'
	] as const;
	const STATUS_OPTIONS = ['draft', 'active', 'completed'] as const;
	const INPUT_MODES = [
		'combobox',
		'multiple_choice',
		'open_text',
		'slider',
		'typeable_number'
	] as const;

	type ChallengeTrack = (typeof data.challengeTracks)[number];

	// Fields relevant per variant
	const VARIANT_FIELDS: Record<string, string[]> = {
		normal: ['artist', 'title', 'year'],
		label: ['label', 'artist', 'title', 'year'],
		anthem: ['festival', 'artist', 'title', 'year'],
		vocal: ['vocal_source', 'artist', 'year'],
		fragments: ['title', 'artist'],
		kick: ['artist'],
		mashup: ['artist', 'title'],
		battle: ['artist', 'title', 'year']
	};

	// Default input modes per variant (must stay in sync with +page.server.ts)
	const DEFAULT_MODES: Record<string, Record<string, string>> = {
		normal: { artist: 'combobox', title: 'open_text', year: 'slider' },
		label: { label: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
		anthem: { festival: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
		vocal: { vocal_source: 'combobox', artist: 'combobox', year: 'slider' },
		fragments: { title: 'open_text', artist: 'combobox' },
		kick: { artist: 'multiple_choice' },
		mashup: { artist: 'combobox', title: 'open_text' },
		battle: { artist: 'combobox', title: 'open_text', year: 'slider' }
	};

	function currentMode(field: string): string {
		const savedModes = ((data.challenge.points_config ?? {}) as Record<string, unknown>)
			.field_modes as Record<string, string> | undefined;
		return savedModes?.[field] ?? DEFAULT_MODES[data.challenge.variant]?.[field] ?? 'open_text';
	}

	const fields = $derived(VARIANT_FIELDS[data.challenge.variant] ?? ['artist', 'title']);

	function optionsFor(field: string): string[] {
		return data.answerOptions.filter((o) => o.field === field).map((o) => o.value);
	}

	function clipsFor(trackId: string) {
		return data.clips.filter((c) => c.track_id === trackId);
	}

	// Clip IDs already attached to this challenge — the unit of deduplication is
	// (track_id, clip_id), not track_id alone. A track can appear multiple times
	// if it has different clip types (e.g. snippet + 4 fragments).
	const usedClipIds = $derived(new Set(data.challengeTracks.map((ct) => ct.clip_id)));

	let selectedTrackId = $state('');
	let selectedClipId = $state('');
	// Only offer clips that aren't already attached to this challenge
	const clipsForSelected = $derived(
		selectedTrackId ? clipsFor(selectedTrackId).filter((c) => !usedClipIds.has(c.id)) : []
	);

	$effect(() => {
		// Reset clip when track changes
		selectedClipId = clipsForSelected[0]?.id ?? '';
	});

	// Difficulty star state
	let difficulty = $state(
		(data.challenge as unknown as { difficulty_rating?: number }).difficulty_rating ?? 3
	);

	// NFC lock override tri-state
	type NfcOverride = 'inherit' | 'true' | 'false';
	const nfcOverrideRaw = (data.challenge as unknown as { nfc_lock_override?: boolean | null })
		.nfc_lock_override;
	let nfcOverride = $state<NfcOverride>(
		nfcOverrideRaw === true ? 'true' : nfcOverrideRaw === false ? 'false' : 'inherit'
	);

	// Points JSON editor
	let pointsJson = $state(JSON.stringify(data.challenge.points_config ?? {}, null, 2));

	// Options editor
	let editingField = $state<string | null>(null);
	let optionsText = $state('');

	function startEditOptions(field: string) {
		editingField = field;
		optionsText = optionsFor(field).join('\n');
	}

	const statusColor: Record<string, string> = {
		draft: 'text-zinc-400',
		active: 'text-green-400',
		completed: 'text-blue-400'
	};

	function trackForCt(ct: ChallengeTrack) {
		return data.allTracks.find((t) => t.id === ct.track_id);
	}

	function clipForCt(ct: ChallengeTrack) {
		return data.clips.find((c) => c.id === ct.clip_id);
	}

	let previewUrl = $state<string | null>(null);
</script>

<div class="max-w-4xl p-6">
	<!-- Header -->
	<div class="mb-6 flex items-start justify-between">
		<div>
			<a
				href="/admin/challenges"
				class="text-sm text-zinc-500 transition-colors hover:text-zinc-300">← Challenges</a
			>
			<div class="mt-1 flex items-center gap-3">
				<div
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {getVariantColor(
						data.challenge.variant
					)}"
				>
					<svelte:component this={getVariantIcon(data.challenge.variant)} size={20} />
				</div>
				<h1 class="text-2xl font-bold text-white">{data.challenge.title}</h1>
			</div>
			<div class="mt-1 flex items-center gap-2">
				<span class="rounded bg-zinc-800 px-2 py-0.5 font-mono text-sm text-zinc-500"
					>{data.challenge.variant}</span
				>
				<span class="text-sm {statusColor[data.challenge.status] ?? 'text-zinc-400'}"
					>{data.challenge.status}</span
				>
			</div>
		</div>

		<!-- Status control + Duplicate -->
		<div class="flex items-center gap-2">
			<form method="POST" action="?/duplicateChallenge" use:enhance>
				<button
					type="submit"
					class="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
					title="Duplicate this challenge"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
						><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path
							d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
						/></svg
					>
					Duplicate
				</button>
			</form>
			<form method="POST" action="?/setStatus" use:enhance class="flex items-center gap-2">
				<select name="status" class="input-field w-auto text-sm">
					{#each STATUS_OPTIONS as s}
						<option value={s} selected={s === data.challenge.status}>{s}</option>
					{/each}
				</select>
				<button type="submit" class="btn-primary text-sm">Set status</button>
			</form>
		</div>
	</div>

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}

	<!-- ── Section 1: Meta ─────────────────────────────────────────── -->
	<section class="mb-5 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="admin-section-title">Settings</h2>
		<form method="POST" action="?/updateMeta" use:enhance class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<input
					name="title"
					value={data.challenge.title}
					placeholder="Name *"
					required
					class="input-field"
				/>
				<input
					name="stage_label"
					value={data.challenge.stage_label ?? ''}
					placeholder="Stage label"
					class="input-field"
				/>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="mb-1 flex items-center text-xs text-zinc-400">
						Variant
						<HelpTooltip text="Determines which fields teams must guess for this challenge." />
					</label>
					<select name="variant" class="input-field">
						{#each VARIANTS as v}
							<option value={v} selected={v === data.challenge.variant}>{v}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="mb-1 flex items-center text-xs text-zinc-400">
						Timer (seconds)
						<HelpTooltip text="Per-team time limit in seconds. Set to 0 to disable the timer." />
					</label>
					<input
						name="timer_seconds"
						type="number"
						value={data.challenge.timer_seconds}
						min="10"
						max="600"
						class="input-field"
					/>
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="mb-1 flex items-center text-xs text-zinc-400">
						Difficulty
						<HelpTooltip
							text="1–5 scale. Final score is multiplied by rating/3 (3 = neutral, 5 = +67%, 1 = −67%)."
						/>
					</label>
					<div class="flex items-center gap-1">
						{#each [1, 2, 3, 4, 5] as star}
							<button
								type="button"
								onclick={() => (difficulty = star)}
								class="text-2xl leading-none transition-colors {difficulty >= star
									? 'text-amber-400'
									: 'text-zinc-700'} hover:text-amber-300"
								aria-label="Difficulty {star}">★</button
							>
						{/each}
						<span class="ml-2 text-xs text-zinc-500">{difficulty}/5</span>
					</div>
					<input type="hidden" name="difficulty_rating" value={difficulty} />
				</div>
				<div>
					<label class="mb-1 flex items-center text-xs text-zinc-400">
						Speed bonus threshold (sec)
						<HelpTooltip
							text="Teams submitting within this many seconds get a +5 speed bonus. Leave empty to disable."
						/>
					</label>
					<input
						name="speed_threshold_seconds"
						type="number"
						min="1"
						max="600"
						placeholder="none"
						value={(data.challenge as unknown as { speed_threshold_seconds?: number | null })
							.speed_threshold_seconds ?? ''}
						class="input-field"
					/>
				</div>
			</div>
			<div>
				<label class="mb-1 flex items-center text-xs text-zinc-400">
					Hint text (optional)
					<HelpTooltip
						text="Shown to teams that scan this challenge's hint NFC card. Leave empty if no hint is needed."
					/>
				</label>
				<textarea
					name="hint_text"
					rows="2"
					placeholder="Leave empty for no hint"
					class="input-field text-sm"
					>{(data.challenge as unknown as { hint_text?: string | null }).hint_text ?? ''}</textarea
				>
			</div>
			<div>
				<label class="mb-2 flex items-center text-xs text-zinc-400">
					NFC unlock required
					<HelpTooltip
						text="Override the set's NFC lock setting. Inherit follows whatever the set is configured for."
					/>
				</label>
				<div class="flex gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 p-1">
					{#each [['inherit', 'Inherit from set'], ['true', 'Always require'], ['false', 'Never require']] as [val, label]}
						<label
							class="flex-1 cursor-pointer rounded px-2 py-1.5 text-center text-xs font-medium transition-colors {nfcOverride ===
							val
								? 'bg-zinc-700 text-white'
								: 'text-zinc-500 hover:text-zinc-300'}"
						>
							<input
								type="radio"
								name="nfc_lock_override"
								value={val}
								bind:group={nfcOverride}
								class="sr-only"
							/>
							{label}
						</label>
					{/each}
				</div>
			</div>
			<div>
				<label class="mb-1 block text-xs text-zinc-400">Points config (JSON)</label>
				<textarea
					name="points_config"
					bind:value={pointsJson}
					rows="5"
					class="input-field font-mono text-xs"
				></textarea>
			</div>
			<div class="flex justify-end">
				<button type="submit" class="btn-primary">Save settings</button>
			</div>
		</form>
	</section>

	<!-- ── Section 2: Tracks ───────────────────────────────────────── -->
	<section class="mb-5 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="admin-section-title">Tracks ({data.challengeTracks.length})</h2>

		<!-- Assigned tracks -->
		{#if data.challengeTracks.length > 0}
			<div class="mb-4 space-y-2">
				{#each data.challengeTracks as ct, i (ct.id)}
					{@const track = trackForCt(ct)}
					{@const clip = clipForCt(ct)}
					<div class="flex items-center gap-3 rounded-lg bg-zinc-800/60 px-3 py-2">
						<span class="w-5 text-center text-sm text-zinc-500">{i + 1}</span>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium text-white">
								{track?.artist ?? '?'} — {track?.title ?? '?'}
								<span class="font-normal text-zinc-500">({track?.year})</span>
							</div>
							<div class="text-xs text-zinc-500">
								Clip: {clip?.type ?? '?'}
								{#if clip?.position != null}
									#{clip.position}{/if}
								· {clip?.storage_path ? clip.storage_path.slice(-40) : '—'}
							</div>
						</div>

						{#if clip}
							<button
								onclick={() =>
									(previewUrl = previewUrl === clip.storage_path ? null : clip.storage_path)}
								class="shrink-0 rounded border border-amber-400/30 px-2 py-0.5 text-xs text-amber-400 transition-colors hover:text-amber-300"
							>
								{previewUrl === clip.storage_path ? '■' : '▶'}
							</button>
						{/if}

						<!-- Reorder -->
						<form method="POST" action="?/reorderTrack" use:enhance>
							<input type="hidden" name="ct_id" value={ct.id} />
							<input type="hidden" name="direction" value="up" />
							<button
								type="submit"
								disabled={i === 0}
								class="px-1 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30">↑</button
							>
						</form>
						<form method="POST" action="?/reorderTrack" use:enhance>
							<input type="hidden" name="ct_id" value={ct.id} />
							<input type="hidden" name="direction" value="down" />
							<button
								type="submit"
								disabled={i === data.challengeTracks.length - 1}
								class="px-1 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30">↓</button
							>
						</form>

						<form method="POST" action="?/removeTrack" use:enhance>
							<input type="hidden" name="ct_id" value={ct.id} />
							<button
								type="submit"
								onclick={(e) => {
									if (!confirm('Remove this track from the challenge?')) e.preventDefault();
								}}
								class="rounded px-2 py-1 text-xs text-red-700 transition-colors hover:bg-zinc-700 hover:text-red-400"
								>✕</button
							>
						</form>
					</div>
				{/each}
			</div>
		{:else}
			<p class="mb-4 text-sm text-zinc-600">No tracks yet — add one below.</p>
		{/if}

		{#if previewUrl}
			<!-- svelte-ignore a11y_media_has_caption -->
			<audio
				src={previewUrl}
				autoplay
				controls
				class="mb-4 h-8 w-full"
				onended={() => (previewUrl = null)}
			></audio>
		{/if}

		<!-- Add track picker -->
		{#if data.allTracks.length > 0}
			<form
				method="POST"
				action="?/addTrack"
				use:enhance
				class="flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-4"
			>
				<div class="min-w-40 flex-1">
					<label class="mb-1 block text-xs text-zinc-400">Track</label>
					<select name="track_id" bind:value={selectedTrackId} required class="input-field">
						<option value="">— choose track —</option>
						{#each data.allTracks as t}
							<option value={t.id}>{t.artist} — {t.title} ({t.year})</option>
						{/each}
					</select>
				</div>
				<div class="min-w-40 flex-1">
					<label class="mb-1 block text-xs text-zinc-400">Clip</label>
					<select
						name="clip_id"
						bind:value={selectedClipId}
						required
						class="input-field"
						disabled={!selectedTrackId || clipsForSelected.length === 0}
					>
						{#if !selectedTrackId}
							<option value="">— choose track first —</option>
						{:else if clipsForSelected.length === 0}
							<option value="">All clips already added</option>
						{:else}
							<option value="">— choose clip —</option>
							{#each clipsForSelected as c}
								<option value={c.id}
									>{c.type}{c.position != null ? ` #${c.position}` : ''} — {c.storage_path.slice(
										-30
									)}</option
								>
							{/each}
						{/if}
					</select>
				</div>
				<button type="submit" class="btn-primary" disabled={!selectedTrackId || !selectedClipId}
					>Add</button
				>
			</form>
		{:else}
			<p class="border-t border-zinc-800 pt-4 text-xs text-zinc-600">
				No tracks in the library yet.
			</p>
		{/if}
	</section>

	<!-- ── Section 3: Input modes ────────────────────────────────── -->
	<section class="mb-5 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="admin-section-title">Input Modes</h2>
		<p class="mb-4 text-xs text-zinc-500">
			Choose how players answer each field. Combobox = search pool; Multiple choice = buttons from
			Answer Options; Open text = free type (fuzzy scored); Slider / Typeable = year.
		</p>

		{#each fields as field}
			<div class="flex items-center gap-3 border-b border-zinc-800 py-2 last:border-0">
				<span class="w-28 text-sm text-zinc-300 capitalize">{field.replace('_', ' ')}</span>
				<form
					method="POST"
					action="?/saveInputMode"
					use:enhance
					class="flex flex-1 items-center gap-2"
				>
					<input type="hidden" name="field" value={field} />
					<select name="mode" class="input-field w-auto text-sm">
						{#each INPUT_MODES as m}
							<option value={m} selected={m === currentMode(field)}>{m}</option>
						{/each}
					</select>
					<button type="submit" class="btn-ghost text-xs whitespace-nowrap">Set</button>
				</form>
				<span class="w-24 text-right text-xs text-zinc-600">now: {currentMode(field)}</span>
			</div>
		{/each}
	</section>

	<!-- ── Section 4: Answer options ──────────────────────────────── -->
	<section class="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="admin-section-title">Answer Options</h2>
		<p class="mb-4 text-xs text-zinc-500">
			Curate the dropdown values players see. Click "Auto-generate" to populate from the track
			library (correct answer + up to 7 distractors). Then edit manually if needed.
		</p>

		{#if data.challengeTracks.length === 0}
			<p class="text-sm text-zinc-600">Add tracks first.</p>
		{:else}
			{#each data.challengeTracks as ct, i (ct.id)}
				{@const track = trackForCt(ct)}
				<div class="mb-5">
					<div class="mb-2 text-sm font-medium text-white">
						Track {i + 1}: {track?.artist} — {track?.title}
					</div>

					{#each fields as field}
						{#if field !== 'year'}
							<div class="mb-3 ml-3">
								<div class="mb-1 flex items-center gap-3">
									<span class="w-24 text-xs text-zinc-400 capitalize"
										>{field.replace('_', ' ')}</span
									>
									<span class="text-xs text-zinc-600">{optionsFor(field).length} options</span>

									<form method="POST" action="?/generateOptions" use:enhance>
										<input type="hidden" name="ct_id" value={ct.id} />
										<input type="hidden" name="field" value={field} />
										<button
											type="submit"
											class="text-xs text-amber-400 transition-colors hover:text-amber-300"
										>
											Auto-generate
										</button>
									</form>

									<button
										onclick={() => startEditOptions(field)}
										class="text-xs text-zinc-400 transition-colors hover:text-zinc-200"
									>
										Edit manually
									</button>
								</div>

								{#if editingField === field}
									<form method="POST" action="?/saveOptions" use:enhance class="flex gap-2">
										<input type="hidden" name="field" value={field} />
										<textarea
											name="options"
											bind:value={optionsText}
											rows="5"
											placeholder="One option per line"
											class="input-field flex-1 font-mono text-xs"
										></textarea>
										<div class="flex flex-col gap-1">
											<button type="submit" class="btn-primary text-xs">Save</button>
											<button
												type="button"
												onclick={() => (editingField = null)}
												class="btn-ghost text-xs">Cancel</button
											>
										</div>
									</form>
								{:else if optionsFor(field).length > 0}
									<div class="ml-0 flex flex-wrap gap-1">
										{#each optionsFor(field) as opt}
											<span class="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
												>{opt}</span
											>
										{/each}
									</div>
								{:else}
									<p class="text-xs text-zinc-600">No options yet.</p>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/each}
		{/if}
	</section>
</div>

<style>
	:global(.admin-section-title) {
		font-size: 0.75rem;
		font-weight: 600;
		color: #a1a1aa;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 1rem;
	}
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
	:global(.btn-primary:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
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
