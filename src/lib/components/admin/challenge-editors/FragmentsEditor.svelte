<script lang="ts">
	import { enhance } from '$app/forms';
	import SearchablePicker from '$lib/components/admin/SearchablePicker.svelte';

	type Track = { id: string; artist: string; title: string; year: number };
	type Clip = { id: string; track_id: string; type: string; storage_path: string; duration: number | null };
	type Tab = { id: string; position: number };
	type TabClip = {
		id: string;
		tab_id: string;
		clip_id: string;
		fragment_number: number | null;
		sort_order: number;
	};

	let {
		tabs,
		clipsByTab,
		allTracks,
		clips
	}: {
		tabs: Tab[];
		clipsByTab: TabClip[];
		allTracks: Track[];
		clips: Clip[];
	} = $props();

	function clipsForTab(tabId: string): TabClip[] {
		return clipsByTab.filter((c) => c.tab_id === tabId).sort((a, b) => a.sort_order - b.sort_order);
	}

	function sourceTracksForTab(tabId: string): Track[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();
		const result: Track[] = [];
		for (const tc of clipsForTab(tabId)) {
			const c = clips.find((c) => c.id === tc.clip_id);
			if (!c) continue;
			if (seen.has(c.track_id)) continue;
			seen.add(c.track_id);
			const t = allTracks.find((t) => t.id === c.track_id);
			if (t) result.push(t);
		}
		return result;
	}

	function formatDur(dur: number | null): string | null {
		if (dur == null || dur <= 0) return null;
		return `${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}`;
	}

	// Per-tab track selection for the two-step add-fragment picker (local UI state only)
	let selectedAddTrack = $state<Record<string, string>>({});

	// Audio preview — only one clip plays at a time
	let audioEls = $state<Record<string, HTMLAudioElement>>({});
	let playingClipId = $state<string | null>(null);

	function playPreview(clipId: string) {
		// Stop whatever is currently playing
		if (playingClipId && playingClipId !== clipId && audioEls[playingClipId]) {
			audioEls[playingClipId].pause();
			audioEls[playingClipId].currentTime = 0;
		}
		const el = audioEls[clipId];
		if (!el) return;
		if (el.paused) {
			el.play();
			playingClipId = clipId;
		} else {
			el.pause();
			el.currentTime = 0;
			playingClipId = null;
		}
	}

</script>

<!-- ── Tabs ── -->
<section class="mb-8">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-sm font-bold tracking-widest text-amber-400 uppercase">Tabs (Fragments)</h2>
		<form method="POST" action="?/addTab" use:enhance class="inline">
			<button
				type="submit"
				class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
			>
				+ Add Tab
			</button>
		</form>
	</div>
	<p class="mb-4 text-xs text-zinc-500">
		Each tab has numbered fragment clips. Source tracks are derived automatically from the clips you
		add.
	</p>

	{#if tabs.length === 0}
		<div
			class="rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-8 text-center text-sm text-zinc-500"
		>
			No tabs yet.
		</div>
	{:else}
		<div class="space-y-6">
			{#each tabs as tab, tabIdx (tab.id)}
				{@const tabClips = clipsForTab(tab.id)}
				{@const sourceTracks = sourceTracksForTab(tab.id)}

				<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
					<div class="mb-3 flex items-center justify-between">
						<span class="text-xs font-bold tracking-widest text-zinc-500 uppercase"
							>Tab {tabIdx + 1}</span
						>
						<form method="POST" action="?/removeTab" use:enhance class="inline">
							<input type="hidden" name="tab_id" value={tab.id} />
							<button
								type="submit"
								onclick={(e) => {
									if (!confirm('Remove this tab?')) e.preventDefault();
								}}
								class="text-xs text-red-700 hover:text-red-400">✕ Remove</button
							>
						</form>
					</div>

					<!-- Fragment clips -->
					<div class="mb-4">
						<span class="mb-2 block text-xs font-semibold text-zinc-400"
							>Fragments ({tabClips.length})</span
						>
						{#if tabClips.length === 0}
							<p class="text-xs text-zinc-600 italic">No fragments yet.</p>
						{:else}
							<div class="mb-2 space-y-1.5">
								{#each tabClips as tc, fragIdx (tc.id)}
									{@const c = clips.find((c) => c.id === tc.clip_id)}
									{@const parentTrack = allTracks.find((t) => c && t.id === c.track_id)}
									<div class="flex items-center gap-2 rounded bg-zinc-800 px-3 py-2 text-xs">
										<span
											class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[10px] font-black text-zinc-950"
										>
											{fragIdx + 1}
										</span>
										<span class="flex-1 text-zinc-300">
											{parentTrack ? `${parentTrack.artist} — ${parentTrack.title}` : 'unknown'}
											{c ? `[${c.type}]` : ''}
											{#if c?.duration}
												<span class="ml-1 text-zinc-500">{formatDur(c.duration)}</span>
											{/if}
										</span>
										{#if c?.storage_path}
											<button
												type="button"
												onclick={() => playPreview(tc.clip_id)}
												class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors
													{playingClipId === tc.clip_id
													? 'bg-amber-400 text-zinc-950'
													: 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}"
												title={playingClipId === tc.clip_id ? 'Stop' : 'Play'}
											>
												{playingClipId === tc.clip_id ? '■' : '▶'}
											</button>
											<audio
												bind:this={audioEls[tc.clip_id]}
												src={c.storage_path}
												crossorigin="anonymous"
												onended={() => (playingClipId = null)}
											></audio>
										{/if}
										<form method="POST" action="?/removeTabClip" use:enhance class="inline">
											<input type="hidden" name="tc_id" value={tc.id} />
											<button type="submit" class="ml-1 text-red-700 hover:text-red-400">✕</button>
										</form>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Add fragment clip — two-step: pick track, then pick clip -->
						<form
							method="POST"
							action="?/addTabClip"
							use:enhance={({ formData, cancel }) => {
								if (!formData.get('clip_id')) {
									// Track picker fired requestSubmit — just update local state
									selectedAddTrack[tab.id] =
										(formData.get('fragment_track_filter') as string) ?? '';
									cancel();
									return;
								}
								// Clip picked — proceed with addTabClip submission, then reset pickers
								return async ({ update }) => {
									await update({ reset: false });
									selectedAddTrack[tab.id] = '';
								};
							}}
							class="space-y-2"
						>
							<input type="hidden" name="tab_id" value={tab.id} />
							<input type="hidden" name="fragment_number" value={tabClips.length + 1} />
							<!-- Step 1: track -->
							<SearchablePicker
								name="fragment_track_filter"
								items={allTracks.map((t) => ({
									id: t.id,
									label: `${t.artist} — ${t.title}`,
									subtitle: String(t.year)
								}))}
								value={selectedAddTrack[tab.id] ?? ''}
								placeholder="1. Pick source track…"
								emptyLabel="— clear —"
							/>
							<!-- Step 2: clip (only once track is chosen; keyed so it remounts on track change) -->
							{#if selectedAddTrack[tab.id]}
								{@const trackClips = clips.filter(
									(c) => c.track_id === selectedAddTrack[tab.id] && c.type !== 'mashup'
								)}
								{#key selectedAddTrack[tab.id]}
									{#if trackClips.length > 0}
										<SearchablePicker
											name="clip_id"
											items={trackClips.map((c) => {
												const dur = formatDur(c.duration);
												return {
													id: c.id,
													label: dur ? `[${c.type}] ${dur}` : `[${c.type}]`,
													subtitle: ''
												};
											})}
											placeholder="2. Pick clip…"
											emptyLabel="— no clip —"
										/>
									{:else}
										<p class="text-xs text-zinc-600 italic">No clips for this track.</p>
									{/if}
								{/key}
							{:else}
								<p class="text-xs text-zinc-600 italic">Pick a track first to see its clips.</p>
							{/if}
							<button
								type="submit"
								class="rounded-lg bg-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-200 hover:bg-zinc-600"
							>
								Add Fragment {tabClips.length + 1}
							</button>
						</form>
					</div>

					<!-- Derived source tracks (read-only) -->
					{#if sourceTracks.length > 0}
						<div>
							<span class="mb-1.5 block text-xs font-semibold text-zinc-400"
								>Source tracks (derived)</span
							>
							<div class="flex flex-wrap gap-1.5">
								{#each sourceTracks as t (t.id)}
									<span class="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300">
										{t.artist} — {t.title} ({t.year})
									</span>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>
