<script lang="ts">
	import { enhance } from '$app/forms';
	import { TYPE_FIELDS } from '$lib/variants';
	import SearchablePicker from '$lib/components/admin/SearchablePicker.svelte';

	type Track = { id: string; artist: string; title: string; year: number };
	type Clip = { id: string; track_id: string; type: string; storage_path: string };
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
		clips,
		pointsConfig,
		fieldModes: savedFieldModes
	}: {
		tabs: Tab[];
		clipsByTab: TabClip[];
		allTracks: Track[];
		clips: Clip[];
		pointsConfig: Record<string, number>;
		fieldModes: Record<string, string>;
	} = $props();

	const INPUT_MODES = [
		'combobox',
		'multiple_choice',
		'open_text',
		'slider',
		'typeable_number'
	] as const;
	const fields = TYPE_FIELDS['fragments'];

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

	function currentMode(field: string): string {
		return savedFieldModes[field] ?? 'open_text';
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
										</span>
										<form method="POST" action="?/removeTabClip" use:enhance class="inline">
											<input type="hidden" name="tc_id" value={tc.id} />
											<button type="submit" class="ml-1 text-red-700 hover:text-red-400">✕</button>
										</form>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Add fragment clip -->
						<form method="POST" action="?/addTabClip" use:enhance class="flex flex-wrap gap-2">
							<input type="hidden" name="tab_id" value={tab.id} />
							<input type="hidden" name="fragment_number" value={tabClips.length + 1} />
							<div class="flex-1">
								<SearchablePicker
									name="clip_id"
									items={clips.map((c) => {
										const t = allTracks.find((t) => t.id === c.track_id);
										return {
											id: c.id,
											label: t ? `${t.artist} — ${t.title}` : c.track_id.slice(0, 8),
											subtitle: `[${c.type}]`
										};
									})}
									placeholder="+ Add fragment clip…"
									emptyLabel="— none —"
								/>
							</div>
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

<!-- ── Field config ── -->
<section>
	<h2 class="mb-3 text-sm font-bold tracking-widest text-amber-400 uppercase">Field Config</h2>
	<div class="space-y-3">
		{#each fields as field (field)}
			<div
				class="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
			>
				<span class="w-28 text-sm font-semibold text-zinc-300 capitalize">
					{field === 'grouping' ? 'Grouping (fragments)' : field}
				</span>
				{#if field === 'grouping'}
					<span class="text-xs text-zinc-500"
						>Binary: full points if player assigns correct fragment set</span
					>
				{/if}
				<label class="flex items-center gap-1.5 text-xs text-zinc-400">
					Max pts
					<form method="POST" action="?/saveFieldPoints" use:enhance class="inline">
						<input
							type="number"
							name="field_points[{field}]"
							value={pointsConfig[field] ?? 10}
							min="1"
							max="50"
							class="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
							onblur={(e) => (e.target as HTMLInputElement).form?.requestSubmit()}
						/>
					</form>
				</label>
				{#if field !== 'grouping'}
					<label class="flex items-center gap-1.5 text-xs text-zinc-400">
						Mode
						<form method="POST" action="?/saveInputMode" use:enhance class="inline">
							<input type="hidden" name="field" value={field} />
							<select
								name="mode"
								class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
								onchange={(e) => (e.target as HTMLSelectElement).form?.requestSubmit()}
							>
								{#each INPUT_MODES as m (m)}
									<option value={m} selected={currentMode(field) === m}>{m}</option>
								{/each}
							</select>
						</form>
					</label>
				{/if}
			</div>
		{/each}
	</div>
</section>
