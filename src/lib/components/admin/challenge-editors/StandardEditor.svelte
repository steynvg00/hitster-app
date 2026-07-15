<script lang="ts">
	import { enhance } from '$app/forms';
	import SearchablePicker from '$lib/components/admin/SearchablePicker.svelte';

	type Track = { id: string; artist: string; title: string; year: number };
	type Clip = {
		id: string;
		track_id: string;
		type: string;
		storage_path: string;
		storage_object_path: string | null;
		duration: number | null;
	};
	type Tab = { id: string; position: number };
	type Src = { id: string; tab_id: string; track_id: string; sort_order: number };
	type TabClip = {
		id: string;
		tab_id: string;
		clip_id: string;
		fragment_number: number | null;
		sort_order: number;
	};

	let {
		tabs,
		sourceTracksByTab,
		clipsByTab,
		allTracks,
		clips
	}: {
		tabs: Tab[];
		sourceTracksByTab: Src[];
		clipsByTab: TabClip[];
		allTracks: Track[];
		clips: Clip[];
	} = $props();

	function srcsForTab(tabId: string): Src[] {
		return sourceTracksByTab
			.filter((s) => s.tab_id === tabId)
			.sort((a, b) => a.sort_order - b.sort_order);
	}

	function clipsForTab(tabId: string): TabClip[] {
		return clipsByTab.filter((c) => c.tab_id === tabId).sort((a, b) => a.sort_order - b.sort_order);
	}

	function clipsForTrack(trackId: string): Clip[] {
		return clips.filter((c) => c.track_id === trackId);
	}

	function formatDur(dur: number | null): string | null {
		if (dur == null || dur <= 0) return null;
		return `${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}`;
	}

	// Multi-clip per tab (C2) — per-clip audio preview, one clip playing at a
	// time. This mirrors FragmentsEditor's own play-state pattern rather than
	// importing a shared component: fragments' clip handling is explicitly out
	// of scope for this change, and the two rows differ (this tab's track is
	// fixed; a fragments clip's track varies row to row), so a shared component
	// would either touch fragments.svelte or carry unused generality. Mirroring
	// is the documented fallback for that tradeoff.
	let audioEls = $state<Record<string, HTMLAudioElement>>({});
	let playingClipId = $state<string | null>(null);

	function playPreview(clipId: string) {
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
		<h2 class="text-sm font-bold tracking-widest text-amber-400 uppercase">Tabs</h2>
		<form method="POST" action="?/addTab" use:enhance class="inline">
			<button
				type="submit"
				class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700"
			>
				+ Add Tab
			</button>
		</form>
	</div>

	{#if tabs.length === 0}
		<div
			class="rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-8 text-center text-sm text-zinc-500"
		>
			No tabs yet — click "+ Add Tab" to create the first one.
		</div>
	{:else}
		<div class="space-y-4">
			{#each tabs as tab, tabIdx (tab.id)}
				{@const srcs = srcsForTab(tab.id)}
				{@const tabClips = clipsForTab(tab.id)}
				{@const src = srcs[0]}

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

					<!-- Source track picker -->
					<div class="mb-3 space-y-3">
						<div>
							<label class="mb-1 block text-xs text-zinc-400">Source track</label>
							<form method="POST" action="?/setTabSourceTrack" use:enhance>
								<input type="hidden" name="tab_id" value={tab.id} />
								<input type="hidden" name="existing_src_id" value={src?.id ?? ''} />
								<SearchablePicker
									name="track_id"
									items={allTracks.map((t) => ({
										id: t.id,
										label: `${t.artist} — ${t.title}`,
										subtitle: String(t.year)
									}))}
									value={src?.track_id ?? ''}
									placeholder="Search tracks…"
									emptyLabel="— no track —"
								/>
							</form>
						</div>

						<!-- Clips (C2: ordered, 1-N per tab — add/remove/reorder, cribbed from
						     FragmentsEditor's per-clip row). Clips don't score (getSourceTracksForTab
						     resolves standard/anthem/label tabs from the source track above, not from
						     these rows) — this list only controls what the player can PLAY. -->
						<div>
							<span class="mb-2 block text-xs font-semibold text-zinc-400"
								>Clips ({tabClips.length})</span
							>
							{#if !src?.track_id}
								<p class="text-xs text-zinc-600 italic">Pick a source track first.</p>
							{:else}
								{#if tabClips.length === 0}
									<p class="mb-2 text-xs text-zinc-600 italic">No clips yet.</p>
								{:else}
									<div class="mb-2 space-y-1.5">
										{#each tabClips as tc, ci (tc.id)}
											{@const c = clips.find((c) => c.id === tc.clip_id)}
											<div class="flex items-center gap-2 rounded bg-zinc-800 px-3 py-2 text-xs">
												<span
													class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[10px] font-black text-zinc-950"
												>
													{ci + 1}
												</span>
												<span class="flex-1 text-zinc-300">
													{c ? `[${c.type}]` : 'unknown clip'}
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
												<form method="POST" action="?/moveTabClip" use:enhance class="inline">
													<input type="hidden" name="tab_id" value={tab.id} />
													<input type="hidden" name="tc_id" value={tc.id} />
													<input type="hidden" name="direction" value="up" />
													<button
														type="submit"
														disabled={ci === 0}
														class="text-zinc-500 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-500"
														title="Move up">▲</button
													>
												</form>
												<form method="POST" action="?/moveTabClip" use:enhance class="inline">
													<input type="hidden" name="tab_id" value={tab.id} />
													<input type="hidden" name="tc_id" value={tc.id} />
													<input type="hidden" name="direction" value="down" />
													<button
														type="submit"
														disabled={ci === tabClips.length - 1}
														class="text-zinc-500 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-500"
														title="Move down">▼</button
													>
												</form>
												<form method="POST" action="?/removeTabClip" use:enhance class="inline">
													<input type="hidden" name="tc_id" value={tc.id} />
													<button type="submit" class="text-red-700 hover:text-red-400">✕</button>
												</form>
											</div>
										{/each}
									</div>
								{/if}

								<!-- Add clip — restricted to the tab's already-chosen source track (only
								     one source track per normal tab; that part is unchanged). Already-added
								     clips are excluded so the host can't add the same clip under two
								     different "Part N" labels by mistake. Keyed on the clip count so the
								     picker remounts blank after each add, mirroring how FragmentsEditor's
								     step-2 picker resets via its own {#key}. -->
								{#key tabClips.length}
									{@const addableClips = clipsForTrack(src.track_id).filter(
										(c) => !tabClips.some((tc) => tc.clip_id === c.id)
									)}
									{#if addableClips.length > 0}
										<form method="POST" action="?/addTabClip" use:enhance>
											<input type="hidden" name="tab_id" value={tab.id} />
											<SearchablePicker
												name="clip_id"
												items={addableClips.map((c) => ({
													id: c.id,
													label: c.type,
													subtitle: formatDur(c.duration) ?? c.storage_path.split('/').pop() ?? ''
												}))}
												placeholder={`Add clip ${tabClips.length + 1}…`}
												emptyLabel="— cancel —"
											/>
										</form>
									{:else if tabClips.length > 0}
										<p class="text-xs text-zinc-600 italic">
											All clips for this track are already added.
										</p>
									{/if}
								{/key}
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>
