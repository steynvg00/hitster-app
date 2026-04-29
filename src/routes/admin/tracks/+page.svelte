<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type TrackRow = (typeof data.tracks)[number];
	type ClipRow = (typeof data.clips)[number];

	const CLIP_TYPES = ['snippet', 'fragment', 'kick', 'vocal', 'mashup'] as const;

	let expandedTrack = $state<string | null>(null);
	let editingTrack = $state<string | null>(null);
	let editingTitles = $state<string | null>(null);
	let showAddForm = $state(false);
	let showAddClipFor = $state<string | null>(null);

	function clipsFor(trackId: string): ClipRow[] {
		return data.clips.filter((c) => c.track_id === trackId);
	}

	function toggleEdit(id: string) {
		editingTrack = editingTrack === id ? null : id;
	}

	function toggleExpand(id: string) {
		expandedTrack = expandedTrack === id ? null : id;
		showAddClipFor = null;
	}

	// Close add form after successful submit
	$effect(() => {
		if (form?.success) {
			showAddForm = false;
			showAddClipFor = null;
			editingTrack = null;
		}
	});

	let previewUrl = $state<string | null>(null);
	let previewAudio = $state<HTMLAudioElement | undefined>(undefined);

	function preview(url: string) {
		previewUrl = previewUrl === url ? null : url;
	}
</script>

<div class="p-6">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white">Tracks</h1>
			<p class="text-zinc-400 text-sm mt-0.5">{data.tracks.length} tracks in library</p>
		</div>
		<button
			onclick={() => (showAddForm = !showAddForm)}
			class="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold px-4 py-2 rounded-lg text-sm transition-colors"
		>
			+ Add Track
		</button>
	</div>

	{#if form?.error}
		<div class="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">
			{form.error}
		</div>
	{/if}

	<!-- Add track form -->
	{#if showAddForm}
		<div class="bg-zinc-900 border border-amber-400/30 rounded-xl p-5 mb-6">
			<h2 class="text-sm font-semibold text-amber-400 uppercase tracking-widest mb-4">New Track</h2>
			<form method="POST" action="?/createTrack" use:enhance class="grid grid-cols-2 gap-3">
				<input name="artist" placeholder="Artist *" required class="input-field" />
				<input name="title" placeholder="Title *" required class="input-field" />
				<input name="year" type="number" placeholder="Year *" required min="1950" max="2030" class="input-field" />
				<input name="record_label" placeholder="Record label" class="input-field" />
				<input name="genre" placeholder="Genre" class="input-field" />
				<input name="subgenre" placeholder="Subgenre" class="input-field" />
				<input name="festival" placeholder="Festival (anthem variant)" class="input-field" />
				<input name="vocal_source" placeholder="Vocal source (movie/show)" class="input-field" />
				<div class="col-span-2 flex gap-2 justify-end mt-1">
					<button type="button" onclick={() => (showAddForm = false)} class="btn-ghost">Cancel</button>
					<button type="submit" class="btn-primary">Add Track</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Track list -->
	<div class="space-y-2">
		{#each data.tracks as track (track.id)}
			<div class="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
				<!-- Track header row -->
				<div class="flex items-center gap-3 px-4 py-3">
					<button
						onclick={() => toggleExpand(track.id)}
						class="text-zinc-500 hover:text-zinc-300 w-5 text-center transition-colors"
						title="Expand clips"
					>
						{expandedTrack === track.id ? '▾' : '▸'}
					</button>

					{#if editingTrack === track.id}
						<form method="POST" action="?/updateTrack" use:enhance class="flex-1 grid grid-cols-4 gap-2 items-center">
							<input type="hidden" name="id" value={track.id} />
							<input name="artist" value={track.artist} required class="input-field text-sm" />
							<input name="title" value={track.title} required class="input-field text-sm" />
							<input name="year" type="number" value={track.year} required class="input-field text-sm" />
							<input name="record_label" value={track.record_label ?? ''} placeholder="Label" class="input-field text-sm" />
							<input name="genre" value={track.genre ?? ''} placeholder="Genre" class="input-field text-sm" />
							<input name="subgenre" value={track.subgenre ?? ''} placeholder="Subgenre" class="input-field text-sm" />
							<input name="festival" value={track.festival ?? ''} placeholder="Festival" class="input-field text-sm" />
							<input name="vocal_source" value={track.vocal_source ?? ''} placeholder="Vocal source" class="input-field text-sm" />
							<div class="col-span-4 flex gap-2 justify-end">
								<button type="button" onclick={() => (editingTrack = null)} class="btn-ghost text-xs">Cancel</button>
								<button type="submit" class="btn-primary text-xs">Save</button>
							</div>
						</form>
					{:else}
						<div class="flex-1 grid grid-cols-4 gap-2 text-sm min-w-0">
							<div class="font-medium text-white truncate">{track.artist}</div>
							<div class="text-zinc-300 truncate">{track.title}</div>
							<div class="text-zinc-500">{track.year}</div>
							<div class="text-zinc-500 truncate">{track.record_label ?? '—'}</div>
						</div>
						<div class="text-xs text-zinc-600">
							{clipsFor(track.id).length} clip{clipsFor(track.id).length !== 1 ? 's' : ''}
						</div>
					{/if}

					{#if editingTrack !== track.id}
						<button
							onclick={() => toggleEdit(track.id)}
							class="text-zinc-500 hover:text-zinc-300 text-xs px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
						>
							Edit
						</button>
						<form method="POST" action="?/deleteTrack" use:enhance>
							<input type="hidden" name="id" value={track.id} />
							<button
								type="submit"
								onclick={(e) => { if (!confirm(`Delete "${track.title}" and all its clips?`)) e.preventDefault(); }}
								class="text-red-600 hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
							>
								Delete
							</button>
						</form>
					{/if}
				</div>

				<!-- Clips panel -->
				{#if expandedTrack === track.id}
					<div class="border-t border-zinc-800 bg-zinc-950 px-4 py-3">
						<div class="text-xs text-zinc-500 uppercase tracking-widest mb-3">Clips</div>

						{#if data.clipsError}
							<p class="text-red-400 text-xs mb-3">Clips failed to load: {data.clipsError}</p>
						{:else if clipsFor(track.id).length === 0}
							<p class="text-zinc-600 text-sm mb-3">No clips yet.</p>
						{:else}
							<div class="space-y-2 mb-3">
								{#each clipsFor(track.id) as clip (clip.id)}
									<div class="flex items-center gap-3 text-sm">
										<span class="text-zinc-500 text-xs font-mono w-16 shrink-0">{clip.type}</span>
										{#if clip.position != null}
											<span class="text-zinc-600 text-xs">#{clip.position}</span>
										{/if}
										<span class="text-zinc-400 truncate flex-1 font-mono text-xs">{clip.storage_path}</span>
										<button
											onclick={() => preview(clip.storage_path)}
											class="text-amber-400 hover:text-amber-300 text-xs px-2 py-0.5 rounded border border-amber-400/30 hover:border-amber-400 transition-colors shrink-0"
										>
											{previewUrl === clip.storage_path ? '■ Stop' : '▶ Play'}
										</button>
										<form method="POST" action="?/deleteClip" use:enhance>
											<input type="hidden" name="id" value={clip.id} />
											<button
												type="submit"
												onclick={(e) => { if (!confirm('Delete this clip?')) e.preventDefault(); }}
												class="text-red-700 hover:text-red-400 text-xs px-2 py-0.5 rounded hover:bg-zinc-800 transition-colors"
											>
												✕
											</button>
										</form>
									</div>
								{/each}
							</div>
						{/if}

						{#if previewUrl}
							<!-- svelte-ignore a11y_media_has_caption -->
							<audio
								bind:this={previewAudio}
								src={previewUrl}
								autoplay
								controls
								class="w-full h-8 mb-3"
								onended={() => (previewUrl = null)}
							></audio>
						{/if}

						<!-- Accepted titles editor -->
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
								<form method="POST" action="?/saveAcceptedTitles" use:enhance class="flex gap-2">
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
									Fuzzy-matched against open-text submissions (90% similarity = correct). Include alternate spellings.
								</p>
							{:else}
								<div class="flex flex-wrap gap-1">
									{#each (track.accepted_titles ?? []) as t}
										<span class="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">{t}</span>
									{:else}
										<span class="text-xs text-zinc-600"
											>None set — defaults to canonical title at scoring time</span
										>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Add clip form -->
						{#if showAddClipFor === track.id}
							<form method="POST" action="?/addClip" use:enhance class="flex gap-2 flex-wrap items-end">
								<input type="hidden" name="track_id" value={track.id} />
								<select name="type" required class="input-field text-sm w-32">
									{#each CLIP_TYPES as t}
										<option value={t}>{t}</option>
									{/each}
								</select>
								<input name="storage_path" placeholder="Audio URL or storage path *" required class="input-field text-sm flex-1 min-w-48" />
								<input name="position" type="number" placeholder="Position (fragments)" class="input-field text-sm w-32" />
								<button type="submit" class="btn-primary text-xs">Add</button>
								<button type="button" onclick={() => (showAddClipFor = null)} class="btn-ghost text-xs">Cancel</button>
							</form>
						{:else}
							<button
								onclick={() => (showAddClipFor = track.id)}
								class="text-amber-400 hover:text-amber-300 text-xs font-medium transition-colors"
							>
								+ Add clip
							</button>
						{/if}
					</div>
				{/if}
			</div>
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
