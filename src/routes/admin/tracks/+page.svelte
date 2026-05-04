<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { PageData, ActionData } from './$types';
	import Waveform from '$lib/components/ui/Waveform.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const CLIP_TYPES = ['snippet', 'fragment', 'kick', 'vocal', 'mashup'] as const;
	type ClipType = (typeof CLIP_TYPES)[number];

	type StagedFile = {
		id: string;
		file: File;
		name: string;
		size: number;
		duration: number;
		clipType: ClipType;
		orderIndex: number | null;
		status: 'queued' | 'uploading' | 'done' | 'failed';
		error?: string;
	};

	// ── search ──────────────────────────────────────────────────────────────────
	let searchQuery = $state('');
	const filteredTracks = $derived(
		searchQuery.trim()
			? data.tracks.filter(
					(t) =>
						t.artist.toLowerCase().includes(searchQuery.toLowerCase()) ||
						t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
						(t.genre ?? '').toLowerCase().includes(searchQuery.toLowerCase())
				)
			: data.tracks
	);

	// ── track panel state ────────────────────────────────────────────────────────
	let expandedTrack = $state<string | null>(null);
	let editingTrack = $state<string | null>(null);
	let editingTitles = $state<string | null>(null);
	let showAddForm = $state(false);
	let addingTrack = $state(false);

	// ── clip selection (bulk delete) ─────────────────────────────────────────────
	let selectedClips = $state(new Set<string>());
	let isDeleting = $state(false);

	// ── drag-and-drop upload state ───────────────────────────────────────────────
	let stagedFiles = $state<Record<string, StagedFile[]>>({});
	let dragOverTrack = $state<string | null>(null);

	// Staged clips for the new-track form — keyed as '__new__' in stagedFiles
	const newTrackStagedFiles = $derived(stagedFiles['__new__'] ?? []);

	// ── helpers ──────────────────────────────────────────────────────────────────
	function clipsFor(trackId: string) {
		return data.clips.filter((c) => c.track_id === trackId);
	}

	function toggleExpand(id: string) {
		expandedTrack = expandedTrack === id ? null : id;
		selectedClips = new Set();
	}

	function formatDuration(s: number | null): string {
		if (!s || s <= 0) return '—';
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function getAudioDuration(file: File): Promise<number> {
		return new Promise((resolve) => {
			const url = URL.createObjectURL(file);
			const audio = new Audio();
			audio.src = url;
			audio.onloadedmetadata = () => {
				resolve(isFinite(audio.duration) ? audio.duration : 0);
				URL.revokeObjectURL(url);
			};
			audio.onerror = () => {
				resolve(0);
				URL.revokeObjectURL(url);
			};
		});
	}

	async function stageFiles(trackId: string, files: FileList | File[]) {
		const incoming = Array.from(files).filter(
			(f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(f.name)
		);
		if (!incoming.length) return;

		const existing = stagedFiles[trackId] ?? [];
		const nextOrder = existing.length + 1;

		const newEntries: StagedFile[] = await Promise.all(
			incoming.map(async (file, i) => ({
				id: crypto.randomUUID(),
				file,
				name: file.name,
				size: file.size,
				duration: await getAudioDuration(file),
				clipType: 'snippet' as ClipType,
				orderIndex: nextOrder + i,
				status: 'queued' as const
			}))
		);

		stagedFiles[trackId] = [...existing, ...newEntries];
	}

	function removeStagedFile(trackId: string, fileId: string) {
		stagedFiles[trackId] = (stagedFiles[trackId] ?? []).filter((f) => f.id !== fileId);
	}

	async function uploadAll(trackId: string) {
		const files = stagedFiles[trackId] ?? [];
		for (const staged of files) {
			if (staged.status !== 'queued') continue;

			staged.status = 'uploading';

			const fd = new FormData();
			fd.append('file', staged.file);
			fd.append('clip_type', staged.clipType);
			if (staged.orderIndex != null) fd.append('order_index', String(staged.orderIndex));
			fd.append('duration', String(staged.duration));

			try {
				const res = await fetch(`/admin/tracks/${trackId}/upload`, { method: 'POST', body: fd });
				if (res.ok) {
					staged.status = 'done';
				} else {
					const text = await res.text();
					staged.status = 'failed';
					staged.error = text || `HTTP ${res.status}`;
				}
			} catch (e) {
				staged.status = 'failed';
				staged.error = String(e);
			}
		}

		await invalidateAll();
		// Clear done entries; keep failed ones so host can see what went wrong
		stagedFiles[trackId] = (stagedFiles[trackId] ?? []).filter((f) => f.status !== 'done');
	}

	async function bulkDelete(trackId: string) {
		const toDelete = [...selectedClips].filter((id) =>
			clipsFor(trackId).some((c) => c.id === id)
		);
		if (!toDelete.length) return;
		if (!confirm(`Delete ${toDelete.length} clip${toDelete.length !== 1 ? 's' : ''}? This cannot be undone.`)) return;

		isDeleting = true;
		try {
			const res = await fetch('/api/admin/clips/bulk-delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ids: toDelete })
			});
			if (!res.ok) {
				const text = await res.text();
				alert(`Delete failed: ${text}`);
			} else {
				selectedClips = new Set();
				await invalidateAll();
			}
		} finally {
			isDeleting = false;
		}
	}

	// Close add-track form after successful server action
	$effect(() => {
		if (form?.success) {
			showAddForm = false;
			editingTrack = null;
		}
	});

	// Per-clip waveform refs and play state
	let waveformRefs = $state<Record<string, Waveform>>({});
	let clipPlaying = $state<Record<string, boolean>>({});
</script>

<div class="p-6">
	<!-- Header -->
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-white">Tracks</h1>
			<p class="mt-0.5 text-sm text-zinc-400">{data.tracks.length} tracks in library</p>
		</div>
		<button
			onclick={() => (showAddForm = !showAddForm)}
			class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
		>
			+ Add Track
		</button>
	</div>

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}

	<!-- Add track form -->
	{#if showAddForm}
		<div class="mb-6 rounded-xl border border-amber-400/30 bg-zinc-900 p-5">
			<h2 class="mb-4 text-sm font-semibold uppercase tracking-widest text-amber-400">
				New Track
			</h2>
			<form
				method="POST"
				action="?/createTrack"
				use:enhance={() => {
					addingTrack = true;
					return async ({ result, update }) => {
						try {
							if (result.type === 'success' && result.data?.id) {
								const trackId = result.data.id as string;
								for (const staged of stagedFiles['__new__'] ?? []) {
									if (staged.status !== 'queued') continue;
									staged.status = 'uploading';
									const fd = new FormData();
									fd.append('file', staged.file);
									fd.append('clip_type', staged.clipType);
									if (staged.orderIndex != null)
										fd.append('order_index', String(staged.orderIndex));
									fd.append('duration', String(staged.duration));
									try {
										const res = await fetch(`/admin/tracks/${trackId}/upload`, {
											method: 'POST',
											body: fd
										});
										staged.status = res.ok ? 'done' : 'failed';
										if (!res.ok) staged.error = await res.text();
									} catch (e) {
										staged.status = 'failed';
										staged.error = String(e);
									}
								}
								stagedFiles['__new__'] = [];
								showAddForm = false;
								await invalidateAll();
							} else {
								await update();
							}
						} finally {
							addingTrack = false;
						}
					};
				}}
				class="grid grid-cols-2 gap-3"
			>
				<input name="artist" placeholder="Artist *" required class="input-field" />
				<input name="title" placeholder="Title *" required class="input-field" />
				<input
					name="year"
					type="number"
					placeholder="Year *"
					required
					min="1950"
					max="2030"
					class="input-field"
				/>
				<input name="record_label" placeholder="Record label" class="input-field" />
				<input name="genre" placeholder="Genre" class="input-field" />
				<input name="subgenre" placeholder="Subgenre" class="input-field" />
				<input name="festival" placeholder="Festival (anthem variant)" class="input-field" />
				<input name="vocal_source" placeholder="Vocal source (movie/show)" class="input-field" />

				<!-- Inline clip drop zone -->
				<div class="col-span-2 mt-1">
					<div class="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">
						Clips (optional)
					</div>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						role="region"
						aria-label="Drop audio files here"
						class="relative cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors {dragOverTrack ===
						'__new__'
							? 'border-amber-400 bg-amber-400/5'
							: 'border-zinc-700 hover:border-zinc-500'}"
						ondragover={(e) => {
							e.preventDefault();
							dragOverTrack = '__new__';
						}}
						ondragleave={() => (dragOverTrack = null)}
						ondrop={async (e) => {
							e.preventDefault();
							dragOverTrack = null;
							if (e.dataTransfer?.files) await stageFiles('__new__', e.dataTransfer.files);
						}}
					>
						<input
							type="file"
							accept="audio/*"
							multiple
							class="absolute inset-0 cursor-pointer opacity-0"
							onchange={async (e) => {
								const files = (e.target as HTMLInputElement).files;
								if (files) await stageFiles('__new__', files);
								(e.target as HTMLInputElement).value = '';
							}}
						/>
						<p class="text-sm text-zinc-500">
							Drop audio clips, or <span class="text-amber-400">click to browse</span>
						</p>
						<p class="mt-0.5 text-xs text-zinc-600">Uploaded with track on save</p>
					</div>

					{#if newTrackStagedFiles.length > 0}
						<div class="mt-2 space-y-1.5">
							{#each newTrackStagedFiles as staged (staged.id)}
								<div
									class="grid items-center gap-x-3 rounded-lg border px-3 py-2 text-sm {staged.status ===
									'done'
										? 'border-green-800 bg-green-950/40'
										: staged.status === 'failed'
											? 'border-red-800 bg-red-950/40'
											: staged.status === 'uploading'
												? 'border-amber-700 bg-amber-950/30'
												: 'border-zinc-700 bg-zinc-900'}"
									style="grid-template-columns: 1.25rem 1fr 7.5rem 5rem 1.25rem"
								>
									<span class="text-center text-xs">
										{#if staged.status === 'queued'}⏳{:else if staged.status === 'uploading'}⬆{:else if staged.status === 'done'}✓{:else}✗{/if}
									</span>
									<div class="min-w-0">
										<div class="truncate text-zinc-200">{staged.name}</div>
										<div class="text-xs text-zinc-500">
											{formatSize(staged.size)}
											{#if staged.duration > 0}· {formatDuration(staged.duration)}{/if}
											{#if staged.error}<span class="text-red-400"> · {staged.error}</span>{/if}
										</div>
									</div>
									<select
										bind:value={staged.clipType}
										disabled={staged.status !== 'queued'}
										class="input-field py-1 text-xs disabled:opacity-50"
									>
										{#each CLIP_TYPES as t}
											<option value={t}>{t}</option>
										{/each}
									</select>
									<input
										type="number"
										bind:value={staged.orderIndex}
										disabled={staged.status !== 'queued'}
										placeholder="Order"
										min="1"
										class="input-field py-1 text-xs disabled:opacity-50"
									/>
									{#if staged.status === 'queued' || staged.status === 'failed'}
										<button
											type="button"
											onclick={() => removeStagedFile('__new__', staged.id)}
											class="text-zinc-600 hover:text-red-400"
											title="Remove"
										>✕</button>
									{:else}
										<span></span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<div class="col-span-2 mt-1 flex justify-end gap-2">
					<button
						type="button"
						onclick={() => {
							showAddForm = false;
							stagedFiles['__new__'] = [];
						}}
						class="btn-ghost">Cancel</button
					>
					<button type="submit" disabled={addingTrack} class="btn-primary">
						{addingTrack ? 'Saving…' : 'Add Track'}
					</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Search -->
	<div class="mb-4">
		<input
			bind:value={searchQuery}
			placeholder="Filter by artist, title, or genre…"
			class="input-field"
		/>
	</div>

	<!-- Track list -->
	<div class="space-y-2">
		{#each filteredTracks as track (track.id)}
			<div class="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
				<!-- Track header row -->
				<div class="flex items-center gap-3 px-4 py-3">
					<button
						onclick={() => toggleExpand(track.id)}
						class="w-5 shrink-0 text-center text-zinc-500 transition-colors hover:text-zinc-300"
						title="Expand clips"
					>
						{expandedTrack === track.id ? '▾' : '▸'}
					</button>

					{#if editingTrack === track.id}
						<form
							method="POST"
							action="?/updateTrack"
							use:enhance
							class="grid flex-1 grid-cols-4 items-center gap-2"
						>
							<input type="hidden" name="id" value={track.id} />
							<input name="artist" value={track.artist} required class="input-field text-sm" />
							<input name="title" value={track.title} required class="input-field text-sm" />
							<input
								name="year"
								type="number"
								value={track.year}
								required
								class="input-field text-sm"
							/>
							<input
								name="record_label"
								value={track.record_label ?? ''}
								placeholder="Label"
								class="input-field text-sm"
							/>
							<input
								name="genre"
								value={track.genre ?? ''}
								placeholder="Genre"
								class="input-field text-sm"
							/>
							<input
								name="subgenre"
								value={track.subgenre ?? ''}
								placeholder="Subgenre"
								class="input-field text-sm"
							/>
							<input
								name="festival"
								value={track.festival ?? ''}
								placeholder="Festival"
								class="input-field text-sm"
							/>
							<input
								name="vocal_source"
								value={track.vocal_source ?? ''}
								placeholder="Vocal source"
								class="input-field text-sm"
							/>
							<div class="col-span-4 flex justify-end gap-2">
								<button
									type="button"
									onclick={() => (editingTrack = null)}
									class="btn-ghost text-xs">Cancel</button
								>
								<button type="submit" class="btn-primary text-xs">Save</button>
							</div>
						</form>
					{:else}
						<div class="grid min-w-0 flex-1 grid-cols-4 gap-2 text-sm">
							<div class="truncate font-medium text-white">{track.artist}</div>
							<div class="truncate text-zinc-300">{track.title}</div>
							<div class="text-zinc-500">{track.year}</div>
							<div class="truncate text-zinc-500">{track.record_label ?? '—'}</div>
						</div>
						<div class="shrink-0 text-xs text-zinc-600">
							{clipsFor(track.id).length} clip{clipsFor(track.id).length !== 1 ? 's' : ''}
						</div>
					{/if}

					{#if editingTrack !== track.id}
						<button
							onclick={() => (editingTrack = track.id)}
							class="rounded px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
						>
							Edit
						</button>
						<form method="POST" action="?/deleteTrack" use:enhance>
							<input type="hidden" name="id" value={track.id} />
							<button
								type="submit"
								onclick={(e) => {
									if (!confirm(`Delete "${track.title}" and all its clips?`)) e.preventDefault();
								}}
								class="rounded px-2 py-1 text-xs text-red-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
							>
								Delete
							</button>
						</form>
					{/if}
				</div>

				<!-- Clips panel -->
				{#if expandedTrack === track.id}
					<div class="border-t border-zinc-800 bg-zinc-950 px-4 py-3">
						<!-- Existing clips -->
						<div class="mb-1 flex items-center justify-between">
							<div class="text-xs uppercase tracking-widest text-zinc-500">Clips</div>
							{#if selectedClips.size > 0}
								<button
									onclick={() => bulkDelete(track.id)}
									disabled={isDeleting}
									class="rounded bg-red-900 px-3 py-1 text-xs font-semibold text-red-300 transition-colors hover:bg-red-800 disabled:opacity-50"
								>
									{isDeleting ? 'Deleting…' : `Delete ${selectedClips.size} selected`}
								</button>
							{/if}
						</div>

						{#if data.clipsError}
							<p class="mb-3 text-xs text-red-400">Clips failed to load: {data.clipsError}</p>
						{:else if clipsFor(track.id).length === 0}
							<p class="mb-3 text-sm text-zinc-600">No clips yet.</p>
						{:else}
							<div class="mb-3 space-y-1">
								{#each clipsFor(track.id) as clip (clip.id)}
									<div class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-900">
										<input
											type="checkbox"
											checked={selectedClips.has(clip.id)}
											onchange={(e) => {
												if ((e.target as HTMLInputElement).checked) {
													selectedClips.add(clip.id);
													selectedClips = new Set(selectedClips);
												} else {
													selectedClips.delete(clip.id);
													selectedClips = new Set(selectedClips);
												}
											}}
											class="accent-amber-400 shrink-0"
										/>
										<span class="w-16 shrink-0 font-mono text-xs text-zinc-500">{clip.type}</span>
										{#if clip.position != null}
											<span class="text-xs text-zinc-600">#{clip.position}</span>
										{/if}
										{#if clip.duration != null}
											<span class="text-xs text-zinc-600">{formatDuration(clip.duration)}</span>
										{/if}
										<div class="flex min-w-0 flex-1 items-center gap-1.5">
											<button
												type="button"
												onclick={() => waveformRefs[clip.id]?.playPause()}
												class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs hover:bg-zinc-600 transition-colors"
												aria-label={clipPlaying[clip.id] ? 'Pause' : 'Play'}
											>
												{clipPlaying[clip.id] ? '⏸' : '▶'}
											</button>
											<div class="min-w-0 flex-1">
												<Waveform
													bind:this={waveformRefs[clip.id]}
													src={clip.storage_path}
													height={32}
													onPlayStateChange={(p) => (clipPlaying[clip.id] = p)}
												/>
											</div>
										</div>
										<form method="POST" action="?/deleteClip" use:enhance class="shrink-0">
											<input type="hidden" name="id" value={clip.id} />
											<button
												type="submit"
												onclick={(e) => {
													if (!confirm('Delete this clip?')) e.preventDefault();
												}}
												class="rounded px-1.5 py-0.5 text-xs text-red-700 transition-colors hover:bg-zinc-800 hover:text-red-400"
											>
												✕
											</button>
										</form>
									</div>
								{/each}
							</div>
						{/if}

						<!-- ── Drop zone ──────────────────────────────────────────────────── -->
						<div class="mt-4 border-t border-zinc-800 pt-3">
							<div class="mb-2 text-xs uppercase tracking-widest text-zinc-500">Upload clips</div>

							<!-- Drop target -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								role="region"
								aria-label="Drop audio files here"
								class="relative cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors {dragOverTrack ===
								track.id
									? 'border-amber-400 bg-amber-400/5'
									: 'border-zinc-700 hover:border-zinc-500'}"
								ondragover={(e) => {
									e.preventDefault();
									dragOverTrack = track.id;
								}}
								ondragleave={() => (dragOverTrack = null)}
								ondrop={async (e) => {
									e.preventDefault();
									dragOverTrack = null;
									if (e.dataTransfer?.files) await stageFiles(track.id, e.dataTransfer.files);
								}}
							>
								<input
									type="file"
									accept="audio/*"
									multiple
									class="absolute inset-0 cursor-pointer opacity-0"
									onchange={async (e) => {
										const files = (e.target as HTMLInputElement).files;
										if (files) await stageFiles(track.id, files);
										(e.target as HTMLInputElement).value = '';
									}}
								/>
								<p class="text-sm text-zinc-500">
									Drag audio files here, or <span class="text-amber-400">click to browse</span>
								</p>
								<p class="mt-1 text-xs text-zinc-600">mp3 · wav · ogg · m4a · flac · webm · max 10 MB each</p>
							</div>

							<!-- Staged file list -->
							{#if (stagedFiles[track.id] ?? []).length > 0}
								<div class="mt-3 space-y-2">
									{#each stagedFiles[track.id] as staged (staged.id)}
										<!--
											Explicit grid columns so .input-field width:100% fills each
											column rather than blowing out the layout:
											[icon] [filename+meta] [type dropdown] [order input] [remove]
										-->
										<div
											class="grid items-center gap-x-3 rounded-lg border px-3 py-2 text-sm {staged.status ===
											'done'
												? 'border-green-800 bg-green-950/40'
												: staged.status === 'failed'
													? 'border-red-800 bg-red-950/40'
													: staged.status === 'uploading'
														? 'border-amber-700 bg-amber-950/30'
														: 'border-zinc-700 bg-zinc-900'}"
											style="grid-template-columns: 1.25rem 1fr 7.5rem 5rem 1.25rem"
										>
											<!-- Status indicator -->
											<span class="text-center text-xs">
												{#if staged.status === 'queued'}⏳
												{:else if staged.status === 'uploading'}⬆
												{:else if staged.status === 'done'}✓
												{:else}✗{/if}
											</span>

											<!-- Filename + meta -->
											<div class="min-w-0">
												<div class="truncate text-zinc-200">{staged.name}</div>
												<div class="text-xs text-zinc-500">
													{formatSize(staged.size)}
													{#if staged.duration > 0}· {formatDuration(staged.duration)}{/if}
													{#if staged.error}<span class="text-red-400"> · {staged.error}</span>{/if}
												</div>
											</div>

											<!-- Clip type -->
											<select
												bind:value={staged.clipType}
												disabled={staged.status !== 'queued'}
												class="input-field py-1 text-xs disabled:opacity-50"
											>
												{#each CLIP_TYPES as t}
													<option value={t}>{t}</option>
												{/each}
											</select>

											<!-- Order index -->
											<input
												type="number"
												bind:value={staged.orderIndex}
												disabled={staged.status !== 'queued'}
												placeholder="Order"
												min="1"
												class="input-field py-1 text-xs disabled:opacity-50"
											/>

											<!-- Remove button (queued/failed only) -->
											{#if staged.status === 'queued' || staged.status === 'failed'}
												<button
													onclick={() => removeStagedFile(track.id, staged.id)}
													class="text-zinc-600 hover:text-red-400"
													title="Remove"
												>
													✕
												</button>
											{:else}
												<span></span>
											{/if}
										</div>
									{/each}
								</div>

								<!-- Upload all button -->
								{#if (stagedFiles[track.id] ?? []).some((f) => f.status === 'queued')}
									<button
										onclick={() => uploadAll(track.id)}
										class="mt-3 rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300"
									>
										Upload {(stagedFiles[track.id] ?? []).filter((f) => f.status === 'queued').length} file{(stagedFiles[track.id] ?? []).filter((f) => f.status === 'queued').length !== 1 ? 's' : ''}
									</button>
								{/if}
							{/if}
						</div>

						<!-- ── Accepted titles ────────────────────────────────────────────── -->
						<div class="mt-4 border-t border-zinc-800 pt-3">
							<div class="mb-2 flex items-center justify-between">
								<div class="text-xs uppercase tracking-widest text-zinc-500">Accepted Titles</div>
								<button
									onclick={() => (editingTitles = editingTitles === track.id ? null : track.id)}
									class="text-xs text-zinc-400 transition-colors hover:text-zinc-200"
								>
									{editingTitles === track.id ? 'Cancel' : 'Edit'}
								</button>
							</div>
							{#if editingTitles === track.id}
								<form
									method="POST"
									action="?/saveAcceptedTitles"
									use:enhance
									class="flex gap-2"
								>
									<input type="hidden" name="id" value={track.id} />
									<textarea
										name="accepted_titles"
										rows="3"
										placeholder="One title per line"
										class="input-field flex-1 font-mono text-xs"
									>{(track.accepted_titles ?? [track.title]).join('\n')}</textarea>
									<button type="submit" class="btn-primary self-start text-xs">Save</button>
								</form>
								<p class="mt-1 text-xs text-zinc-600">
									Fuzzy-matched against open-text submissions (90% = correct). Include alternate
									spellings.
								</p>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each track.accepted_titles ?? [] as t}
										<span class="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300"
											>{t}</span
										>
									{:else}
										<span class="text-xs text-zinc-600"
											>None set — defaults to canonical title at scoring time</span
										>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<p class="py-8 text-center text-zinc-600">
				{searchQuery ? 'No tracks match your filter.' : 'No tracks yet.'}
			</p>
		{/each}
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
