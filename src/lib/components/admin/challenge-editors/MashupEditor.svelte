<script lang="ts">
	import { enhance } from '$app/forms';
	import { TYPE_FIELDS } from '$lib/variants';

	type Track = { id: string; artist: string; title: string; year: number };
	type Clip = { id: string; track_id: string; type: string; storage_path: string };
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
		clips,
		pointsConfig,
		fieldModes: savedFieldModes
	}: {
		tabs: Tab[];
		sourceTracksByTab: Src[];
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
	const fields = TYPE_FIELDS['mashup'];

	function srcsForTab(tabId: string): Src[] {
		return sourceTracksByTab
			.filter((s) => s.tab_id === tabId)
			.sort((a, b) => a.sort_order - b.sort_order);
	}

	function clipsForTab(tabId: string): TabClip[] {
		return clipsByTab.filter((c) => c.tab_id === tabId).sort((a, b) => a.sort_order - b.sort_order);
	}

	function currentMode(field: string): string {
		return savedFieldModes[field] ?? 'open_text';
	}

	let addTrackSelections = $state<Record<string, string>>({});
</script>

<!-- ── Tabs ── -->
<section class="mb-8">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-sm font-bold tracking-widest text-amber-400 uppercase">Tabs (Mashup)</h2>
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
		Each tab has one mashup clip and N source tracks. Players identify all source tracks.
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
				{@const srcs = srcsForTab(tab.id)}
				{@const tabClips = clipsForTab(tab.id)}
				{@const mashupClip = tabClips[0]}

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

					<!-- Mashup clip (any clip in library) -->
					<div class="mb-4">
						<label class="mb-1 block text-xs text-zinc-400">Mashup clip</label>
						<form method="POST" action="?/setTabClip" use:enhance>
							<input type="hidden" name="tab_id" value={tab.id} />
							<input type="hidden" name="existing_clip_id" value={mashupClip?.id ?? ''} />
							<select
								name="clip_id"
								class="input-field"
								onchange={(e) => (e.target as HTMLSelectElement).form?.requestSubmit()}
							>
								<option value="">— pick any clip —</option>
								{#each clips as c (c.id)}
									{@const t = allTracks.find((t) => t.id === c.track_id)}
									<option value={c.id} selected={mashupClip?.clip_id === c.id}>
										{t ? `${t.artist} — ${t.title}` : c.track_id.slice(0, 8)} [{c.type}]
									</option>
								{/each}
							</select>
						</form>
					</div>

					<!-- Source tracks list -->
					<div class="mb-3">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-xs font-semibold text-zinc-400">Source Tracks ({srcs.length})</span>
						</div>

						{#if srcs.length === 0}
							<p class="text-xs text-zinc-600 italic">No source tracks yet — add at least 2.</p>
						{:else}
							<div class="mb-2 space-y-1">
								{#each srcs as src (src.id)}
									{@const t = allTracks.find((t) => t.id === src.track_id)}
									<div
										class="flex items-center justify-between rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
									>
										<span
											>{t ? `${t.artist} — ${t.title} (${t.year})` : src.track_id.slice(0, 8)}</span
										>
										<form method="POST" action="?/removeTabSourceTrack" use:enhance class="inline">
											<input type="hidden" name="src_id" value={src.id} />
											<button type="submit" class="ml-2 text-red-700 hover:text-red-400">✕</button>
										</form>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Add another source track -->
						<form method="POST" action="?/addTabSourceTrack" use:enhance class="flex gap-2">
							<input type="hidden" name="tab_id" value={tab.id} />
							<select
								name="track_id"
								bind:value={addTrackSelections[tab.id]}
								class="input-field flex-1"
							>
								<option value="">+ Add source track…</option>
								{#each allTracks as t (t.id)}
									<option value={t.id}>{t.artist} — {t.title} ({t.year})</option>
								{/each}
							</select>
							<button
								type="submit"
								class="rounded-lg bg-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-200 hover:bg-zinc-600"
							>
								Add
							</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<!-- ── Field config ── -->
<section>
	<h2 class="mb-3 text-sm font-bold tracking-widest text-amber-400 uppercase">
		Field Config (applied per slot)
	</h2>
	<div class="space-y-3">
		{#each fields as field (field)}
			<div
				class="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
			>
				<span class="w-28 text-sm font-semibold text-zinc-300 capitalize">{field}</span>
				<label class="flex items-center gap-1.5 text-xs text-zinc-400">
					Max pts
					<form method="POST" action="?/updateMeta" use:enhance class="inline">
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
			</div>
		{/each}
	</div>
</section>
