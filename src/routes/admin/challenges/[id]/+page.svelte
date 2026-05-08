<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const VARIANTS = ['normal','label','anthem','vocal','fragments','kick','mashup','battle'] as const;
	const STATUS_OPTIONS = ['draft', 'active', 'completed'] as const;
	const INPUT_MODES = ['combobox', 'multiple_choice', 'open_text', 'slider', 'typeable_number'] as const;

	type ChallengeTrack = (typeof data.challengeTracks)[number];

	// Fields relevant per variant
	const VARIANT_FIELDS: Record<string, string[]> = {
		normal:    ['artist', 'title', 'year'],
		label:     ['label', 'artist', 'title', 'year'],
		anthem:    ['festival', 'artist', 'title', 'year'],
		vocal:     ['vocal_source', 'artist', 'year'],
		fragments: ['title', 'artist'],
		kick:      ['artist'],
		mashup:    ['artist', 'title'],
		battle:    ['artist', 'title', 'year']
	};

	// Default input modes per variant (must stay in sync with +page.server.ts)
	const DEFAULT_MODES: Record<string, Record<string, string>> = {
		normal:    { artist: 'combobox', title: 'open_text', year: 'slider' },
		label:     { label: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
		anthem:    { festival: 'combobox', artist: 'combobox', title: 'open_text', year: 'slider' },
		vocal:     { vocal_source: 'combobox', artist: 'combobox', year: 'slider' },
		fragments: { title: 'open_text', artist: 'combobox' },
		kick:      { artist: 'multiple_choice' },
		mashup:    { artist: 'combobox', title: 'open_text' },
		battle:    { artist: 'combobox', title: 'open_text', year: 'slider' }
	};

	function currentMode(field: string): string {
		const savedModes = ((data.challenge.points_config ?? {}) as Record<string, unknown>).field_modes as Record<string, string> | undefined;
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
		selectedTrackId
			? clipsFor(selectedTrackId).filter((c) => !usedClipIds.has(c.id))
			: []
	);

	$effect(() => {
		// Reset clip when track changes
		selectedClipId = clipsForSelected[0]?.id ?? '';
	});

	// Difficulty star state
	let difficulty = $state((data.challenge as unknown as { difficulty_rating?: number }).difficulty_rating ?? 3);

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

<div class="p-6 max-w-4xl">
	<!-- Header -->
	<div class="flex items-start justify-between mb-6">
		<div>
			<a href="/admin/challenges" class="text-zinc-500 hover:text-zinc-300 text-sm transition-colors">← Challenges</a>
			<h1 class="text-2xl font-bold text-white mt-1">{data.challenge.title}</h1>
			<div class="flex items-center gap-2 mt-1">
				<span class="text-sm font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">{data.challenge.variant}</span>
				<span class="text-sm {statusColor[data.challenge.status] ?? 'text-zinc-400'}">{data.challenge.status}</span>
			</div>
		</div>

		<!-- Status control -->
		<form method="POST" action="?/setStatus" use:enhance class="flex gap-2 items-center">
			<select name="status" class="input-field w-auto text-sm">
				{#each STATUS_OPTIONS as s}
					<option value={s} selected={s === data.challenge.status}>{s}</option>
				{/each}
			</select>
			<button type="submit" class="btn-primary text-sm">Set status</button>
		</form>
	</div>

	{#if form?.error}
		<div class="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{form.error}</div>
	{/if}

	<!-- ── Section 1: Meta ─────────────────────────────────────────── -->
	<section class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-5">
		<h2 class="admin-section-title">Settings</h2>
		<form method="POST" action="?/updateMeta" use:enhance class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<input name="title" value={data.challenge.title} placeholder="Name *" required class="input-field" />
				<input name="stage_label" value={data.challenge.stage_label ?? ''} placeholder="Stage label" class="input-field" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="block text-xs text-zinc-400 mb-1">Variant</label>
					<select name="variant" class="input-field">
						{#each VARIANTS as v}
							<option value={v} selected={v === data.challenge.variant}>{v}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="block text-xs text-zinc-400 mb-1">Timer (seconds)</label>
					<input name="timer_seconds" type="number" value={data.challenge.timer_seconds} min="10" max="600" class="input-field" />
				</div>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="block text-xs text-zinc-400 mb-1">Difficulty</label>
					<div class="flex gap-1 items-center">
						{#each [1,2,3,4,5] as star}
							<button
								type="button"
								onclick={() => difficulty = star}
								class="text-2xl leading-none transition-colors {difficulty >= star ? 'text-amber-400' : 'text-zinc-700'} hover:text-amber-300"
								aria-label="Difficulty {star}"
							>★</button>
						{/each}
						<span class="ml-2 text-xs text-zinc-500">{difficulty}/5</span>
					</div>
					<input type="hidden" name="difficulty_rating" value={difficulty} />
				</div>
				<div>
					<label class="block text-xs text-zinc-400 mb-1">Speed bonus threshold (sec, optional)</label>
					<input name="speed_threshold_seconds" type="number" min="1" max="600" placeholder="none"
						value={(data.challenge as unknown as { speed_threshold_seconds?: number | null }).speed_threshold_seconds ?? ''}
						class="input-field" />
				</div>
			</div>
			<div>
				<label class="block text-xs text-zinc-400 mb-1">Hint text (optional — shown when team scans hint NFC tag)</label>
				<textarea name="hint_text" rows="2" placeholder="Leave empty for no hint"
					class="input-field text-sm">{(data.challenge as unknown as { hint_text?: string | null }).hint_text ?? ''}</textarea>
			</div>
			<div>
				<label class="block text-xs text-zinc-400 mb-1">Points config (JSON)</label>
				<textarea name="points_config" bind:value={pointsJson} rows="5" class="input-field font-mono text-xs"></textarea>
			</div>
			<div class="flex justify-end">
				<button type="submit" class="btn-primary">Save settings</button>
			</div>
		</form>
	</section>

	<!-- ── Section 2: Tracks ───────────────────────────────────────── -->
	<section class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-5">
		<h2 class="admin-section-title">Tracks ({data.challengeTracks.length})</h2>

		<!-- Assigned tracks -->
		{#if data.challengeTracks.length > 0}
			<div class="space-y-2 mb-4">
				{#each data.challengeTracks as ct, i (ct.id)}
					{@const track = trackForCt(ct)}
					{@const clip = clipForCt(ct)}
					<div class="flex items-center gap-3 bg-zinc-800/60 rounded-lg px-3 py-2">
						<span class="text-zinc-500 text-sm w-5 text-center">{i + 1}</span>
						<div class="flex-1 min-w-0">
							<div class="text-white text-sm font-medium truncate">
								{track?.artist ?? '?'} — {track?.title ?? '?'}
								<span class="text-zinc-500 font-normal">({track?.year})</span>
							</div>
							<div class="text-zinc-500 text-xs">
								Clip: {clip?.type ?? '?'}
								{#if clip?.position != null} #{clip.position}{/if}
								· {clip?.storage_path ? clip.storage_path.slice(-40) : '—'}
							</div>
						</div>

						{#if clip}
							<button
								onclick={() => previewUrl = previewUrl === clip.storage_path ? null : clip.storage_path}
								class="text-amber-400 hover:text-amber-300 text-xs px-2 py-0.5 rounded border border-amber-400/30 transition-colors shrink-0"
							>
								{previewUrl === clip.storage_path ? '■' : '▶'}
							</button>
						{/if}

						<!-- Reorder -->
						<form method="POST" action="?/reorderTrack" use:enhance>
							<input type="hidden" name="ct_id" value={ct.id} />
							<input type="hidden" name="direction" value="up" />
							<button type="submit" disabled={i === 0} class="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 text-xs px-1">↑</button>
						</form>
						<form method="POST" action="?/reorderTrack" use:enhance>
							<input type="hidden" name="ct_id" value={ct.id} />
							<input type="hidden" name="direction" value="down" />
							<button type="submit" disabled={i === data.challengeTracks.length - 1} class="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 text-xs px-1">↓</button>
						</form>

						<form method="POST" action="?/removeTrack" use:enhance>
							<input type="hidden" name="ct_id" value={ct.id} />
							<button
								type="submit"
								onclick={(e) => { if (!confirm('Remove this track from the challenge?')) e.preventDefault(); }}
								class="text-red-700 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-zinc-700 transition-colors"
							>✕</button>
						</form>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-zinc-600 text-sm mb-4">No tracks yet — add one below.</p>
		{/if}

		{#if previewUrl}
			<!-- svelte-ignore a11y_media_has_caption -->
			<audio src={previewUrl} autoplay controls class="w-full h-8 mb-4" onended={() => previewUrl = null}></audio>
		{/if}

		<!-- Add track picker -->
		{#if data.allTracks.length > 0}
			<form method="POST" action="?/addTrack" use:enhance class="flex gap-2 flex-wrap items-end border-t border-zinc-800 pt-4">
				<div class="flex-1 min-w-40">
					<label class="block text-xs text-zinc-400 mb-1">Track</label>
					<select name="track_id" bind:value={selectedTrackId} required class="input-field">
						<option value="">— choose track —</option>
						{#each data.allTracks as t}
							<option value={t.id}>{t.artist} — {t.title} ({t.year})</option>
						{/each}
					</select>
				</div>
				<div class="flex-1 min-w-40">
					<label class="block text-xs text-zinc-400 mb-1">Clip</label>
					<select name="clip_id" bind:value={selectedClipId} required class="input-field" disabled={!selectedTrackId || clipsForSelected.length === 0}>
						{#if !selectedTrackId}
							<option value="">— choose track first —</option>
						{:else if clipsForSelected.length === 0}
							<option value="">All clips already added</option>
						{:else}
							<option value="">— choose clip —</option>
							{#each clipsForSelected as c}
								<option value={c.id}>{c.type}{c.position != null ? ` #${c.position}` : ''} — {c.storage_path.slice(-30)}</option>
							{/each}
						{/if}
					</select>
				</div>
				<button type="submit" class="btn-primary" disabled={!selectedTrackId || !selectedClipId}>Add</button>
			</form>
		{:else}
			<p class="text-zinc-600 text-xs border-t border-zinc-800 pt-4">No tracks in the library yet.</p>
		{/if}
	</section>

	<!-- ── Section 3: Input modes ────────────────────────────────── -->
	<section class="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-5">
		<h2 class="admin-section-title">Input Modes</h2>
		<p class="text-zinc-500 text-xs mb-4">
			Choose how players answer each field. Combobox = search pool; Multiple choice = buttons from
			Answer Options; Open text = free type (fuzzy scored); Slider / Typeable = year.
		</p>

		{#each fields as field}
			<div class="flex items-center gap-3 py-2 border-b border-zinc-800 last:border-0">
				<span class="w-28 text-sm text-zinc-300 capitalize">{field.replace('_', ' ')}</span>
				<form method="POST" action="?/saveInputMode" use:enhance class="flex items-center gap-2 flex-1">
					<input type="hidden" name="field" value={field} />
					<select name="mode" class="input-field w-auto text-sm">
						{#each INPUT_MODES as m}
							<option value={m} selected={m === currentMode(field)}>{m}</option>
						{/each}
					</select>
					<button type="submit" class="btn-ghost text-xs whitespace-nowrap">Set</button>
				</form>
				<span class="text-xs text-zinc-600 w-24 text-right">now: {currentMode(field)}</span>
			</div>
		{/each}
	</section>

	<!-- ── Section 4: Answer options ──────────────────────────────── -->
	<section class="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
		<h2 class="admin-section-title">Answer Options</h2>
		<p class="text-zinc-500 text-xs mb-4">
			Curate the dropdown values players see. Click "Auto-generate" to populate from the track library
			(correct answer + up to 7 distractors). Then edit manually if needed.
		</p>

		{#if data.challengeTracks.length === 0}
			<p class="text-zinc-600 text-sm">Add tracks first.</p>
		{:else}
			{#each data.challengeTracks as ct, i (ct.id)}
				{@const track = trackForCt(ct)}
				<div class="mb-5">
					<div class="text-sm font-medium text-white mb-2">
						Track {i + 1}: {track?.artist} — {track?.title}
					</div>

					{#each fields as field}
						{#if field !== 'year'}
							<div class="mb-3 ml-3">
								<div class="flex items-center gap-3 mb-1">
									<span class="text-xs text-zinc-400 w-24 capitalize">{field.replace('_', ' ')}</span>
									<span class="text-xs text-zinc-600">{optionsFor(field).length} options</span>

									<form method="POST" action="?/generateOptions" use:enhance>
										<input type="hidden" name="ct_id" value={ct.id} />
										<input type="hidden" name="field" value={field} />
										<button type="submit" class="text-xs text-amber-400 hover:text-amber-300 transition-colors">
											Auto-generate
										</button>
									</form>

									<button
										onclick={() => startEditOptions(field)}
										class="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
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
											class="input-field font-mono text-xs flex-1"
										></textarea>
										<div class="flex flex-col gap-1">
											<button type="submit" class="btn-primary text-xs">Save</button>
											<button type="button" onclick={() => editingField = null} class="btn-ghost text-xs">Cancel</button>
										</div>
									</form>
								{:else if optionsFor(field).length > 0}
									<div class="flex flex-wrap gap-1 ml-0">
										{#each optionsFor(field) as opt}
											<span class="text-xs bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">{opt}</span>
										{/each}
									</div>
								{:else}
									<p class="text-zinc-600 text-xs">No options yet.</p>
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
	:global(.input-field:focus) { outline: none; border-color: #fbbf24; }
	:global(.btn-primary) {
		background: #fbbf24; color: #09090b; font-weight: 700;
		padding: 0.4rem 1rem; border-radius: 0.5rem; font-size: 0.875rem;
		transition: background 0.15s;
	}
	:global(.btn-primary:hover) { background: #fcd34d; }
	:global(.btn-primary:disabled) { opacity: 0.4; cursor: not-allowed; }
	:global(.btn-ghost) {
		background: transparent; border: 1px solid #3f3f46; color: #a1a1aa;
		font-weight: 500; padding: 0.4rem 1rem; border-radius: 0.5rem;
		font-size: 0.875rem; transition: all 0.15s;
	}
	:global(.btn-ghost:hover) { border-color: #71717a; color: #f4f4f5; }
</style>
