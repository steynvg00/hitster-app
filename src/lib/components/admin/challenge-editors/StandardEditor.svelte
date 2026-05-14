<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ChallengeType } from '$lib/types/index.js';
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
	type AnswerOption = { id: string; field: string; value: string };

	let {
		type,
		tabs,
		sourceTracksByTab,
		clipsByTab,
		allTracks,
		clips,
		answerOptions,
		pointsConfig,
		fieldModes: savedFieldModes
	}: {
		type: ChallengeType;
		tabs: Tab[];
		sourceTracksByTab: Src[];
		clipsByTab: TabClip[];
		allTracks: Track[];
		clips: Clip[];
		answerOptions: AnswerOption[];
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

	const fields = $derived(TYPE_FIELDS[type] ?? ['artist', 'title', 'year']);

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

	function optionsFor(field: string): string[] {
		return answerOptions.filter((o) => o.field === field).map((o) => o.value);
	}

	function currentMode(field: string): string {
		return savedFieldModes[field] ?? 'open_text';
	}

	let selectedTrackForTab = $state<Record<string, string>>({});
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
					<div class="mb-3 grid grid-cols-2 gap-3">
						<div>
							<label class="mb-1 block text-xs text-zinc-400">Source track</label>
							<form method="POST" action="?/setTabSourceTrack" use:enhance>
								<input type="hidden" name="tab_id" value={tab.id} />
								<input type="hidden" name="existing_src_id" value={src?.id ?? ''} />
								<select
									name="track_id"
									class="input-field"
									onchange={(e) => {
										selectedTrackForTab[tab.id] = (e.target as HTMLSelectElement).value;
										(e.target as HTMLSelectElement).form?.requestSubmit();
									}}
								>
									<option value="">— pick a track —</option>
									{#each allTracks as t (t.id)}
										<option value={t.id} selected={src?.track_id === t.id}>
											{t.artist} — {t.title} ({t.year})
										</option>
									{/each}
								</select>
							</form>
						</div>

						<div>
							<label class="mb-1 block text-xs text-zinc-400">Clip</label>
							{#if src?.track_id}
								<form method="POST" action="?/setTabClip" use:enhance>
									<input type="hidden" name="tab_id" value={tab.id} />
									<input type="hidden" name="existing_clip_id" value={tabClip?.id ?? ''} />
									<select
										name="clip_id"
										class="input-field"
										onchange={(e) => (e.target as HTMLSelectElement).form?.requestSubmit()}
									>
										<option value="">— pick a clip —</option>
										{#each clipsForTrack(src.track_id) as c (c.id)}
											<option value={c.id} selected={tabClip?.clip_id === c.id}>
												{c.type} — {c.storage_path.split('/').pop()}
											</option>
										{/each}
									</select>
								</form>
							{:else}
								<p class="text-xs text-zinc-600 italic">Pick a track first</p>
							{/if}
						</div>
					</div>

					{#if tabClip && src?.track_id}
						<p class="text-xs text-zinc-600">Clip: {tabClip.clip_id.slice(0, 8)}…</p>
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
				<span class="w-28 text-sm font-semibold text-zinc-300 capitalize">{field}</span>

				<!-- Max points -->
				<label class="flex items-center gap-1.5 text-xs text-zinc-400">
					Max pts
					<form method="POST" action="?/updateMeta" use:enhance class="inline">
						{#each fields as f (f)}
							<input
								type="hidden"
								name="field_points[{f}]"
								value={f === field ? undefined : (pointsConfig[f] ?? 10)}
							/>
						{/each}
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

				<!-- Input mode -->
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

				<!-- Manage multiple-choice options -->
				{#if currentMode(field) === 'multiple_choice'}
					<div class="w-full">
						<form method="POST" action="?/saveOptions" use:enhance class="flex flex-col gap-1">
							<input type="hidden" name="field" value={field} />
							<textarea
								name="options"
								rows="3"
								placeholder="One option per line"
								class="input-field font-mono text-xs">{optionsFor(field).join('\n')}</textarea
							>
							<button
								type="submit"
								class="self-start rounded bg-zinc-700 px-3 py-1 text-xs text-white hover:bg-zinc-600"
								>Save options</button
							>
						</form>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>
