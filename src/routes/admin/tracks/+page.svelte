<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll, goto } from '$app/navigation';
	import type { PageData, ActionData } from './$types';
	import Waveform from '$lib/components/ui/Waveform.svelte';
	import TrimModal from '$lib/components/ui/TrimModal.svelte';
	import { Music } from 'lucide-svelte';
	import HelpTooltip from '$lib/components/ui/HelpTooltip.svelte';
	import SearchablePicker from '$lib/components/admin/SearchablePicker.svelte';

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

	// ── search / filter ─────────────────────────────────────────────────────────
	function setParam(key: string, value: string) {
		const u = new URL(location.href);
		if (value) u.searchParams.set(key, value);
		else u.searchParams.delete(key);
		goto(`${u.pathname}${u.search}`, { replaceState: true, noScroll: true });
	}

	let searchQuery = $state(data.q);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;
	function onSearchInput(val: string) {
		searchQuery = val;
		if (searchTimeout) clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => setParam('q', val), 300);
	}

	const hasActiveFilters = $derived(!!(data.q || data.genreFilter || data.hasClips !== 'all'));

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
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
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
		const all = Array.from(files);

		const videoFiles = all.filter(
			(f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|mkv|avi)$/i.test(f.name)
		);
		const incoming = all.filter(
			(f) =>
				!videoFiles.includes(f) &&
				(f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(f.name))
		);

		for (const vf of videoFiles) {
			extractAudioFromVideo(trackId, vf);
		}

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
		const toDelete = [...selectedClips].filter((id) => clipsFor(trackId).some((c) => c.id === id));
		if (!toDelete.length) return;
		if (
			!confirm(
				`Delete ${toDelete.length} clip${toDelete.length !== 1 ? 's' : ''}? This cannot be undone.`
			)
		)
			return;

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

	// Mashup section state
	let expandedMashup = $state<string | null>(null);
	let editingMashup = $state<string | null>(null);
	let showCreateMashup = $state(false);
	let mashupAddTrack = $state<Record<string, string>>({});

	// Trim modal state
	type TrimState = { file: File; trackId: string; orderIndex: number | null } | null;
	let trimModal = $state<TrimState>(null);

	function openTrim(trackId: string, file: File, orderIndex: number | null = null) {
		trimModal = { file, trackId, orderIndex };
	}

	async function onTrimUploaded(_trackId: string) {
		trimModal = null;
		await invalidateAll();
	}

	// ── ffmpeg singleton (video extraction) ───────────────────────────────────
	let ffmpegSingleton: import('@ffmpeg/ffmpeg').FFmpeg | null = null;

	async function getFFmpeg() {
		if (ffmpegSingleton) return ffmpegSingleton;
		const { FFmpeg } = await import('@ffmpeg/ffmpeg');
		const ff = new FFmpeg();
		await ff.load({ coreURL: '/ffmpeg/ffmpeg-core.js', wasmURL: '/ffmpeg/ffmpeg-core.wasm' });
		ffmpegSingleton = ff;
		return ff;
	}

	// ── video extraction ──────────────────────────────────────────────────────
	type VideoExtraction = {
		id: string;
		name: string;
		size: number;
		progress: number;
		status: 'extracting' | 'done' | 'failed';
		error?: string;
	};
	let videoExtractions = $state<Record<string, VideoExtraction[]>>({});

	async function extractAudioFromVideo(trackId: string, file: File) {
		const extractionId = crypto.randomUUID();
		videoExtractions[trackId] = [
			...(videoExtractions[trackId] ?? []),
			{ id: extractionId, name: file.name, size: file.size, progress: 0, status: 'extracting' }
		];

		const getIdx = () => (videoExtractions[trackId] ?? []).findIndex((v) => v.id === extractionId);

		try {
			const ff = await getFFmpeg();
			const { fetchFile } = await import('@ffmpeg/util');

			const progressHandler = ({ progress }: { progress: number }) => {
				const idx = getIdx();
				if (idx >= 0) videoExtractions[trackId][idx].progress = Math.round(progress * 100);
			};
			ff.on('progress', progressHandler);

			const safeId = extractionId.replace(/-/g, '');
			const ext = file.name.split('.').pop() ?? 'mp4';
			const inputName = `in_${safeId}.${ext}`;
			const outputName = `out_${safeId}.mp3`;

			await ff.writeFile(inputName, await fetchFile(file));
			await ff.exec([
				'-i',
				inputName,
				'-vn',
				'-ar',
				'44100',
				'-ac',
				'2',
				'-b:a',
				'192k',
				outputName
			]);
			ff.off('progress', progressHandler);

			const data = await ff.readFile(outputName);
			await ff.deleteFile(inputName);
			await ff.deleteFile(outputName);

			const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' });
			const friendlyName = file.name.replace(/\.[^.]+$/, '.mp3');
			const mp3File = new File([blob], friendlyName, { type: 'audio/mpeg' });

			const idx = getIdx();
			if (idx >= 0) videoExtractions[trackId][idx].status = 'done';

			await stageFiles(trackId, [mp3File]);

			setTimeout(() => {
				videoExtractions[trackId] = (videoExtractions[trackId] ?? []).filter(
					(v) => v.id !== extractionId
				);
			}, 2000);
		} catch (e) {
			const idx = getIdx();
			if (idx >= 0) {
				videoExtractions[trackId][idx].status = 'failed';
				videoExtractions[trackId][idx].error = String(e);
			}
		}
	}
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
			<h2 class="mb-4 text-sm font-semibold tracking-widest text-amber-400 uppercase">New Track</h2>
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
					<div class="mb-1 text-xs font-semibold tracking-widest text-zinc-500 uppercase">
						Clips (optional)
					</div>
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
							accept="audio/*,video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v"
							multiple
							class="absolute inset-0 cursor-pointer opacity-0"
							onchange={async (e) => {
								const files = (e.target as HTMLInputElement).files;
								if (files) await stageFiles('__new__', files);
								(e.target as HTMLInputElement).value = '';
							}}
						/>
						<p class="text-sm text-zinc-500">
							Drop audio or video clips, or <span class="text-amber-400">click to browse</span>
						</p>
						<p class="mt-0.5 text-xs text-zinc-600">mp3/wav/m4a · mp4/mov → audio extracted</p>
					</div>

					{#if (videoExtractions['__new__'] ?? []).length > 0}
						<div class="mt-2 space-y-1.5">
							{#each videoExtractions['__new__'] as extraction (extraction.id)}
								<div
									class="grid items-center gap-x-3 rounded-lg border border-amber-700 bg-amber-950/20 px-3 py-2 text-sm"
									style="grid-template-columns: 1.25rem 1fr 1.25rem"
								>
									<span class="text-center text-xs text-amber-400">⟳</span>
									<div class="min-w-0">
										<div class="truncate text-zinc-200">{extraction.name}</div>
										<div class="text-xs text-zinc-500">
											{formatSize(extraction.size)} ·
											{#if extraction.status === 'extracting'}
												<span class="text-amber-400">Extracting audio… {extraction.progress}%</span>
											{:else if extraction.status === 'done'}
												<span class="text-green-400">Done</span>
											{:else}
												<span class="text-red-400">{extraction.error}</span>
											{/if}
										</div>
										{#if extraction.status === 'extracting'}
											<div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-700">
												<div
													class="h-full bg-amber-400 transition-all"
													style="width: {extraction.progress}%"
												></div>
											</div>
										{/if}
									</div>
									{#if extraction.status === 'failed'}
										<button
											type="button"
											onclick={() => {
												videoExtractions['__new__'] = (videoExtractions['__new__'] ?? []).filter(
													(v) => v.id !== extraction.id
												);
											}}
											class="text-zinc-600 hover:text-red-400"
											title="Dismiss">✕</button
										>
									{:else}
										<span></span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

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
											title="Remove">✕</button
										>
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

	<!-- Search / filter / sort -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<input
			value={searchQuery}
			oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
			placeholder="Filter by artist, title, or genre…"
			class="min-w-[200px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:border-amber-400 focus:outline-none"
		/>
		<select
			value={data.genreFilter}
			onchange={(e) => setParam('genre', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="">All genres</option>
			{#each data.allGenres as g (g)}
				<option value={g}>{g}</option>
			{/each}
		</select>
		<select
			value={data.hasClips}
			onchange={(e) => setParam('has_clips', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="all">Any clips</option>
			<option value="yes">Has clips</option>
			<option value="no">No clips</option>
		</select>
		<select
			value={data.sort}
			onchange={(e) => setParam('sort', (e.target as HTMLSelectElement).value)}
			class="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 focus:border-amber-400 focus:outline-none"
		>
			<option value="name_asc">Name A→Z</option>
			<option value="name_desc">Name Z→A</option>
			<option value="created_desc">Newest first</option>
			<option value="created_asc">Oldest first</option>
			<option value="genre_asc">Genre A→Z</option>
		</select>
	</div>

	<!-- Track list -->
	<div class="space-y-2">
		{#each data.tracks as track (track.id)}
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
							<div class="text-xs tracking-widest text-zinc-500 uppercase">Clips</div>
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
									<div class="rounded-lg hover:bg-zinc-900">
										<!-- Clip row -->
										<div class="flex items-center gap-2 px-2 py-1.5">
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
												class="shrink-0 accent-amber-400"
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
													class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-xs transition-colors hover:bg-zinc-600"
													aria-label={clipPlaying[clip.id] ? 'Pause' : 'Play'}
												>
													{clipPlaying[clip.id] ? '⏸' : '▶'}
												</button>
												<div class="min-w-0 flex-1">
													<Waveform
														bind:this={waveformRefs[clip.id]}
														src={clip.storage_path}
														height={32}
														effects={clip.effects ?? {}}
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
									</div>
								{/each}
							</div>
						{/if}

						<!-- ── Drop zone ──────────────────────────────────────────────────── -->
						<div class="mt-4 border-t border-zinc-800 pt-3">
							<div class="mb-2 flex items-center justify-between">
								<span class="text-xs tracking-widest text-zinc-500 uppercase">Upload clips</span>
								<!-- Trim upload: single file → opens trim modal -->
								<label
									class="cursor-pointer rounded-lg border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-amber-400/50 hover:text-amber-400"
								>
									✂ Upload + Trim
									<input
										type="file"
										accept="audio/*"
										class="hidden"
										onchange={async (e) => {
											const files = (e.target as HTMLInputElement).files;
											if (files?.[0])
												openTrim(track.id, files[0], (stagedFiles[track.id] ?? []).length + 1);
											(e.target as HTMLInputElement).value = '';
										}}
									/>
								</label>
							</div>

							<!-- Drop target (quick upload — pre-trimmed files) -->
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
									accept="audio/*,video/mp4,video/quicktime,video/x-m4v,.mp4,.mov,.m4v"
									multiple
									class="absolute inset-0 cursor-pointer opacity-0"
									onchange={async (e) => {
										const files = (e.target as HTMLInputElement).files;
										if (files) await stageFiles(track.id, files);
										(e.target as HTMLInputElement).value = '';
									}}
								/>
								<p class="text-sm text-zinc-500">
									Quick upload — drag pre-trimmed files, or <span class="text-amber-400"
										>click to browse</span
									>
								</p>
								<p class="mt-1 text-xs text-zinc-600">
									mp3/wav/ogg/m4a/flac · mp4/mov → audio extracted
								</p>
							</div>

							<!-- Video extraction progress -->
							{#if (videoExtractions[track.id] ?? []).length > 0}
								<div class="mt-3 space-y-2">
									{#each videoExtractions[track.id] as extraction (extraction.id)}
										<div
											class="grid items-center gap-x-3 rounded-lg border border-amber-700 bg-amber-950/20 px-3 py-2 text-sm"
											style="grid-template-columns: 1.25rem 1fr 1.25rem"
										>
											<span class="text-center text-xs text-amber-400">⟳</span>
											<div class="min-w-0">
												<div class="truncate text-zinc-200">{extraction.name}</div>
												<div class="text-xs text-zinc-500">
													{formatSize(extraction.size)} ·
													{#if extraction.status === 'extracting'}
														<span class="text-amber-400"
															>Extracting audio… {extraction.progress}%</span
														>
													{:else if extraction.status === 'done'}
														<span class="text-green-400">Done</span>
													{:else}
														<span class="text-red-400">{extraction.error}</span>
													{/if}
												</div>
												{#if extraction.status === 'extracting'}
													<div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-700">
														<div
															class="h-full bg-amber-400 transition-all"
															style="width: {extraction.progress}%"
														></div>
													</div>
												{/if}
											</div>
											{#if extraction.status === 'failed'}
												<button
													onclick={() => {
														videoExtractions[track.id] = (videoExtractions[track.id] ?? []).filter(
															(v) => v.id !== extraction.id
														);
													}}
													class="text-zinc-600 hover:text-red-400"
													title="Dismiss">✕</button
												>
											{:else}
												<span></span>
											{/if}
										</div>
									{/each}
								</div>
							{/if}

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
											<div class="flex items-center gap-1">
												<select
													bind:value={staged.clipType}
													disabled={staged.status !== 'queued'}
													class="input-field min-w-0 flex-1 py-1 text-xs disabled:opacity-50"
												>
													{#each CLIP_TYPES as t}
														<option value={t}>{t}</option>
													{/each}
												</select>
												<HelpTooltip text="Which variant this clip can be used for." />
											</div>

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
										Upload {(stagedFiles[track.id] ?? []).filter((f) => f.status === 'queued')
											.length} file{(stagedFiles[track.id] ?? []).filter(
											(f) => f.status === 'queued'
										).length !== 1
											? 's'
											: ''}
									</button>
								{/if}
							{/if}
						</div>

						<!-- ── Accepted titles ────────────────────────────────────────────── -->
						<div class="mt-4 border-t border-zinc-800 pt-3">
							<div class="mb-2 flex items-center justify-between">
								<div class="flex items-center text-xs tracking-widest text-zinc-500 uppercase">
									Accepted Titles
									<HelpTooltip
										text="Alternative spellings of the title that count as correct in open-text submissions (fuzzy matched at 90% similarity)."
									/>
								</div>
								<button
									onclick={() => (editingTitles = editingTitles === track.id ? null : track.id)}
									class="text-xs text-zinc-400 transition-colors hover:text-zinc-200"
								>
									{editingTitles === track.id ? 'Cancel' : 'Edit'}
								</button>
							</div>
							{#if editingTitles === track.id}
								<form method="POST" action="?/saveAcceptedTitles" use:enhance class="flex gap-2">
									<input type="hidden" name="id" value={track.id} />
									<textarea
										name="accepted_titles"
										rows="3"
										placeholder="One title per line"
										class="input-field flex-1 font-mono text-xs"
										>{(track.accepted_titles ?? [track.title]).join('\n')}</textarea
									>
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
			{#if hasActiveFilters}
				<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-12 text-center">
					<p class="text-sm font-semibold text-zinc-400">No tracks match the current filters</p>
					<a
						href="/admin/tracks"
						class="mt-3 inline-block rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
					>
						Clear filters
					</a>
				</div>
			{:else}
				<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-14 text-center">
					<Music size={64} class="mx-auto mb-4 text-zinc-700" />
					<p class="text-base font-bold text-zinc-300">No tracks yet</p>
					<p class="mt-1 text-sm text-zinc-500">
						Click "+ Add Track" above to add your first track
					</p>
				</div>
			{/if}
		{/each}
	</div>
</div>

<!-- ── Mashups ──────────────────────────────────────────────────────────────── -->
<div class="mt-8 px-6">
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-sm font-bold tracking-widest text-amber-400 uppercase">Mashups</h2>
		<button
			type="button"
			onclick={() => (showCreateMashup = !showCreateMashup)}
			class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
		>
			+ Create Mashup
		</button>
	</div>

	{#if showCreateMashup}
		<form
			method="POST"
			action="?/createMashup"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: true });
					showCreateMashup = false;
				}}
			class="mb-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4"
		>
			<div class="mb-3 grid grid-cols-2 gap-3">
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Name</label>
					<input
						type="text"
						name="name"
						required
						placeholder="e.g. Hardstyle Megamix Vol. 1"
						class="input-field"
					/>
				</div>
				<div>
					<label class="mb-1 block text-xs text-zinc-400">Primary clip</label>
					<SearchablePicker
						name="primary_clip_id"
						items={data.clips.map((c) => {
							const t = data.tracks.find((t) => t.id === c.track_id);
							return {
								id: c.id,
								label: t ? `${t.artist} — ${t.title}` : c.track_id.slice(0, 8),
								subtitle: `[${c.type}]`
							};
						})}
						placeholder="Search clips…"
						emptyLabel="— select a clip —"
					/>
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (showCreateMashup = false)}
					class="rounded px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
				>
					Cancel
				</button>
				<button
					type="submit"
					class="rounded-lg bg-amber-400 px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-300"
				>
					Create
				</button>
			</div>
		</form>
	{/if}

	{#if data.mashups.length === 0 && !showCreateMashup}
		<div
			class="rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-8 text-center text-sm text-zinc-500"
		>
			No mashups yet — create one above to use in mashup-type challenges.
		</div>
	{:else}
		<div class="space-y-2">
			{#each data.mashups as mashup (mashup.id)}
				{@const sources = data.mashupSources.filter((s) => s.mashup_id === mashup.id)}
				{@const primaryClip = data.clips.find((c) => c.id === mashup.primary_clip_id)}
				{@const primaryTrack = primaryClip
					? data.tracks.find((t) => t.id === primaryClip.track_id)
					: null}

				<div class="rounded-xl border border-zinc-800 bg-zinc-900">
					<!-- Header row -->
					<div class="flex items-center gap-3 px-4 py-3">
						<button
							type="button"
							onclick={() => (expandedMashup = expandedMashup === mashup.id ? null : mashup.id)}
							class="flex flex-1 items-center gap-3 text-left"
						>
							<span class="font-semibold text-zinc-200">{mashup.name}</span>
							<span class="text-xs text-zinc-500">
								{#if primaryTrack}
									clip: {primaryTrack.artist} — {primaryTrack.title}
								{:else}
									no primary clip
								{/if}
							</span>
							<span class="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
								{sources.length} source{sources.length === 1 ? '' : 's'}
							</span>
						</button>
						<form method="POST" action="?/deleteMashup" use:enhance class="shrink-0">
							<input type="hidden" name="id" value={mashup.id} />
							<button
								type="submit"
								onclick={(e) => {
									if (!confirm('Delete this mashup?')) e.preventDefault();
								}}
								class="rounded px-1.5 py-0.5 text-xs text-red-700 hover:text-red-400">✕</button
							>
						</form>
					</div>

					{#if expandedMashup === mashup.id}
						<div class="space-y-4 border-t border-zinc-800 px-4 py-4">
							<!-- Edit name / primary clip -->
							{#if editingMashup === mashup.id}
								<form
									method="POST"
									action="?/updateMashup"
									use:enhance={() =>
										async ({ update }) => {
											await update({ reset: false });
											editingMashup = null;
										}}
									class="grid grid-cols-2 gap-3"
								>
									<input type="hidden" name="id" value={mashup.id} />
									<div>
										<label class="mb-1 block text-xs text-zinc-400">Name</label>
										<input
											type="text"
											name="name"
											value={mashup.name}
											required
											class="input-field"
										/>
									</div>
									<div>
										<label class="mb-1 block text-xs text-zinc-400">Primary clip</label>
										<SearchablePicker
											name="primary_clip_id"
											items={data.clips.map((c) => {
												const t = data.tracks.find((t) => t.id === c.track_id);
												return {
													id: c.id,
													label: t ? `${t.artist} — ${t.title}` : c.track_id.slice(0, 8),
													subtitle: `[${c.type}]`
												};
											})}
											value={mashup.primary_clip_id}
											placeholder="Search clips…"
											emptyLabel="— select a clip —"
										/>
									</div>
									<div class="col-span-2 flex justify-end gap-2">
										<button
											type="button"
											onclick={() => (editingMashup = null)}
											class="rounded px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300"
										>
											Cancel
										</button>
										<button
											type="submit"
											class="rounded bg-amber-400 px-3 py-1 text-xs font-bold text-zinc-950 hover:bg-amber-300"
										>
											Save
										</button>
									</div>
								</form>
							{:else}
								<div class="flex items-center justify-between">
									<div>
										{#if primaryClip}
											<audio controls crossorigin="anonymous" src={primaryClip.storage_path} class="h-8 w-full rounded"
											></audio>
										{/if}
									</div>
									<button
										type="button"
										onclick={() => (editingMashup = mashup.id)}
										class="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
									>
										Edit
									</button>
								</div>
							{/if}

							<!-- Source tracks -->
							<div>
								<span class="mb-2 block text-xs font-semibold text-zinc-400">Source Tracks</span>
								{#if sources.length === 0}
									<p class="mb-2 text-xs text-zinc-600 italic">No source tracks yet.</p>
								{:else}
									<div class="mb-2 space-y-1">
										{#each sources as src (src.id)}
											{@const srcTrack = data.tracks.find((t) => t.id === src.track_id)}
											<div
												class="flex items-center justify-between rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
											>
												<span>
													{srcTrack
														? `${srcTrack.artist} — ${srcTrack.title} (${srcTrack.year})`
														: src.track_id.slice(0, 8)}
												</span>
												<form
													method="POST"
													action="?/removeMashupSource"
													use:enhance
													class="inline"
												>
													<input type="hidden" name="id" value={src.id} />
													<button type="submit" class="ml-2 text-red-700 hover:text-red-400"
														>✕</button
													>
												</form>
											</div>
										{/each}
									</div>
								{/if}
								<form method="POST" action="?/addMashupSource" use:enhance class="flex gap-2">
									<input type="hidden" name="mashup_id" value={mashup.id} />
									<div class="flex-1">
										<SearchablePicker
											name="track_id"
											items={data.tracks.map((t) => ({
												id: t.id,
												label: `${t.artist} — ${t.title}`,
												subtitle: String(t.year)
											}))}
											bind:value={mashupAddTrack[mashup.id]}
											placeholder="+ Add source track…"
											emptyLabel="— none —"
										/>
									</div>
									<button
										type="submit"
										class="rounded-lg bg-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-200 hover:bg-zinc-600"
									>
										Add
									</button>
								</form>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if trimModal}
	<TrimModal
		file={trimModal.file}
		trackId={trimModal.trackId}
		orderIndex={trimModal.orderIndex}
		onClose={() => (trimModal = null)}
		onUploaded={() => onTrimUploaded(trimModal!.trackId)}
	/>
{/if}

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
