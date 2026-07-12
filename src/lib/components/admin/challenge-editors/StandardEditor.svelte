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
				{@const tabClip = tabClips[0]}

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

						<div>
							<label class="mb-1 block text-xs text-zinc-400">Clip</label>
							{#if src?.track_id}
								<form method="POST" action="?/setTabClip" use:enhance>
									<input type="hidden" name="tab_id" value={tab.id} />
									<input type="hidden" name="existing_clip_id" value={tabClip?.id ?? ''} />
									<SearchablePicker
										name="clip_id"
										items={clipsForTrack(src.track_id).map((c) => ({
											id: c.id,
											label: c.type,
											subtitle: c.storage_path.split('/').pop() ?? ''
										}))}
										value={tabClip?.clip_id ?? ''}
										placeholder="Search clips…"
										emptyLabel="— no clip —"
									/>
								</form>
								{#if tabClip?.clip_id}
									{@const previewClip = clips.find((c) => c.id === tabClip.clip_id)}
									{#if previewClip}
										<audio controls crossorigin="anonymous" src={previewClip.storage_path} class="mt-2 h-8 w-full rounded"
										></audio>
									{/if}
								{/if}
							{:else}
								<p class="text-xs text-zinc-600 italic">Pick a track first</p>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>
