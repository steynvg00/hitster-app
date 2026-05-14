<script lang="ts">
	import { enhance } from '$app/forms';
	import { TYPE_FIELDS } from '$lib/variants';
	import SearchablePicker from '$lib/components/admin/SearchablePicker.svelte';

	type Track = { id: string; artist: string; title: string; year: number };
	type Clip = { id: string; track_id: string; type: string; storage_path: string };
	type Tab = { id: string; position: number; mashup_id?: string | null };
	type Mashup = { id: string; name: string; primary_clip_id: string };
	type MashupSource = { id: string; mashup_id: string; track_id: string; sort_order: number };

	let {
		tabs,
		mashups,
		mashupSources,
		allTracks,
		clips,
		pointsConfig,
		fieldModes: savedFieldModes
	}: {
		tabs: Tab[];
		mashups: Mashup[];
		mashupSources: MashupSource[];
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

	function sourcesForMashup(mashupId: string): MashupSource[] {
		return mashupSources
			.filter((s) => s.mashup_id === mashupId)
			.sort((a, b) => a.sort_order - b.sort_order);
	}

	function currentMode(field: string): string {
		return savedFieldModes[field] ?? 'open_text';
	}
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
		Each tab is a mashup. Pick a pre-configured mashup — its clip and source tracks are set in the
		Mashup manager.
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
				{@const mashup = mashups.find((m) => m.id === tab.mashup_id)}
				{@const mashupClip = mashup ? clips.find((c) => c.id === mashup.primary_clip_id) : null}
				{@const sources = tab.mashup_id ? sourcesForMashup(tab.mashup_id) : []}

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

					<!-- Mashup picker -->
					<div class="mb-4">
						<label class="mb-1 block text-xs text-zinc-400">Mashup</label>
						<form method="POST" action="?/setTabMashup" use:enhance>
							<input type="hidden" name="tab_id" value={tab.id} />
							<SearchablePicker
								name="mashup_id"
								items={mashups.map((m) => ({ id: m.id, label: m.name }))}
								value={tab.mashup_id ?? ''}
								placeholder="Search mashups…"
								emptyLabel="— no mashup —"
							/>
						</form>
						{#if mashupClip}
							<audio controls src={mashupClip.storage_path} class="mt-2 h-8 w-full rounded"></audio>
						{/if}
					</div>

					<!-- Source tracks (read-only, derived from mashup) -->
					{#if mashup}
						<div>
							<span class="mb-2 block text-xs font-semibold text-zinc-400"
								>Source tracks ({sources.length})</span
							>
							{#if sources.length === 0}
								<p class="text-xs text-zinc-600 italic">
									No sources configured — edit in Mashup manager.
								</p>
							{:else}
								<div class="flex flex-wrap gap-1.5">
									{#each sources as src (src.id)}
										{@const t = allTracks.find((t) => t.id === src.track_id)}
										<span class="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300">
											{t ? `${t.artist} — ${t.title} (${t.year})` : src.track_id.slice(0, 8)}
										</span>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
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
