<script lang="ts">
	import { enhance } from '$app/forms';
	import { TYPE_FIELDS } from '$lib/variants';
	import type { EffectsConfig } from '$lib/types/index.js';
	import SearchablePicker from '$lib/components/admin/SearchablePicker.svelte';
	import Waveform from '$lib/components/ui/Waveform.svelte';

	type Track = { id: string; artist: string; title: string; year: number };
	type Clip = {
		id: string;
		track_id: string;
		type: string;
		storage_path: string;
		storage_object_path: string | null;
	};
	type Tab = { id: string; position: number; effects?: unknown };
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

	const INPUT_MODES = [
		'combobox',
		'multiple_choice',
		'open_text',
		'slider',
		'typeable_number'
	] as const;
	const fields = TYPE_FIELDS['effects'];

	function currentMode(field: string): string {
		return savedFieldModes[field] ?? 'open_text';
	}

	// Local effects state per tab — initialised from server data
	let tabEffects = $state<Record<string, EffectsConfig>>(
		Object.fromEntries(tabs.map((t) => [t.id, (t.effects as EffectsConfig) ?? {}]))
	);

	let saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

	function pitchOf(cfg: EffectsConfig) {
		return cfg.pitch ?? { enabled: false, semitones: 0 };
	}
	function tempoOf(cfg: EffectsConfig) {
		return cfg.tempo ?? { enabled: false, rate: 1.0 };
	}
	function lowpassOf(cfg: EffectsConfig) {
		return cfg.lowpass ?? { enabled: false, cutoff_hz: 2000 };
	}
	function highpassOf(cfg: EffectsConfig) {
		return cfg.highpass ?? { enabled: false, cutoff_hz: 200 };
	}
	function bandpassOf(cfg: EffectsConfig) {
		return cfg.bandpass ?? { enabled: false, freq_hz: 1000, q: 1.0 };
	}
	function phaserOf(cfg: EffectsConfig) {
		return cfg.phaser ?? { enabled: false, rate_hz: 0.5, depth: 0.5 };
	}
	function flangerOf(cfg: EffectsConfig) {
		return cfg.flanger ?? { enabled: false, rate_hz: 0.25, depth: 0.5 };
	}

	// Auto-save with 600 ms debounce — posts to ?/saveTabEffects
	function schedSave(tabId: string) {
		clearTimeout(saveTimers[tabId]);
		saveTimers[tabId] = setTimeout(() => doSave(tabId), 600);
	}

	async function doSave(tabId: string) {
		const fd = new FormData();
		fd.append('tab_id', tabId);
		fd.append('effects_json', JSON.stringify(tabEffects[tabId]));
		await fetch('?/saveTabEffects', { method: 'POST', body: fd });
	}

	// Toggle an effect on/off — writes enabled:false rather than removing the entry,
	// so slider values survive a disable/re-enable cycle.
	function toggleEffect(tabId: string, key: keyof EffectsConfig) {
		const cfg = tabEffects[tabId] ?? {};
		switch (key) {
			case 'pitch':
				tabEffects[tabId] = { ...cfg, pitch: { ...pitchOf(cfg), enabled: !pitchOf(cfg).enabled } };
				break;
			case 'tempo':
				tabEffects[tabId] = { ...cfg, tempo: { ...tempoOf(cfg), enabled: !tempoOf(cfg).enabled } };
				break;
			case 'lowpass':
				tabEffects[tabId] = {
					...cfg,
					lowpass: { ...lowpassOf(cfg), enabled: !lowpassOf(cfg).enabled }
				};
				break;
			case 'highpass':
				tabEffects[tabId] = {
					...cfg,
					highpass: { ...highpassOf(cfg), enabled: !highpassOf(cfg).enabled }
				};
				break;
			case 'bandpass':
				tabEffects[tabId] = {
					...cfg,
					bandpass: { ...bandpassOf(cfg), enabled: !bandpassOf(cfg).enabled }
				};
				break;
			case 'phaser':
				tabEffects[tabId] = {
					...cfg,
					phaser: { ...phaserOf(cfg), enabled: !phaserOf(cfg).enabled }
				};
				break;
			case 'flanger':
				tabEffects[tabId] = {
					...cfg,
					flanger: { ...flangerOf(cfg), enabled: !flangerOf(cfg).enabled }
				};
				break;
		}
		schedSave(tabId);
	}

	const EFFECT_KEYS: (keyof EffectsConfig)[] = [
		'pitch',
		'tempo',
		'lowpass',
		'highpass',
		'bandpass',
		'phaser',
		'flanger'
	];
	const EFFECT_LABELS: Record<keyof EffectsConfig, string> = {
		pitch: 'Pitch',
		tempo: 'Tempo',
		lowpass: 'Lowpass',
		highpass: 'Highpass',
		bandpass: 'Bandpass',
		phaser: 'Phaser',
		flanger: 'Flanger'
	};

	// WET preview — per-tab Waveform refs + playing state.
	// wetRefs stores the component instance (exported playPause/pause/getIsPlaying).
	// Typed as any to avoid Svelte 5 bind:this variance issues.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const wetRefs: Record<string, any> = {};
	let wetPlaying = $state<Record<string, boolean>>({});
</script>

<!-- ── Tabs ── -->
<section class="mb-8">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-sm font-bold tracking-widest text-amber-400 uppercase">Tabs (Effects)</h2>
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
		Each tab is an audio clip with its own FX chain. Players hear the processed clip and guess
		artist · title · year.
	</p>

	{#if tabs.length === 0}
		<div
			class="rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-8 text-center text-sm text-zinc-500"
		>
			No tabs yet — click "+ Add Tab" to create the first one.
		</div>
	{:else}
		<div class="space-y-4">
			{#each tabs as tab, tabIdx (tab.id)}
				{@const cfg = tabEffects[tab.id] ?? {}}
				{@const srcs = srcsForTab(tab.id)}
				{@const tabClips = clipsForTab(tab.id)}
				{@const src = srcs[0]}
				{@const tabClip = tabClips[0]}
				{@const previewClip = tabClip?.clip_id ? clips.find((c) => c.id === tabClip.clip_id) : null}
				{@const anyEnabled = EFFECT_KEYS.some((k) => !!(cfg[k] as { enabled?: boolean } | undefined)?.enabled)}

				<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
					<!-- Tab header -->
					<div class="mb-4 flex items-center justify-between">
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

					<!-- 1. Source track picker -->
					<div class="mb-3">
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

					<!-- 2. Clip picker -->
					<div class="mb-3">
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
						{:else}
							<p class="text-xs text-zinc-600 italic">Pick a track first</p>
						{/if}
					</div>

					<!-- 3. DRY preview (original, no effects) -->
					{#if previewClip}
						<div class="mb-4">
							<span class="text-xs text-zinc-600">Original (dry)</span>
							<audio
								controls
								crossorigin="anonymous"
								src={previewClip.storage_path}
								class="mt-1 h-8 w-full rounded"
							></audio>
						</div>
					{/if}

					<!-- 4. Toggle pill row -->
					<div class="mb-3">
						<span class="mb-2 block text-xs text-zinc-500">Effects</span>
						<div class="flex flex-wrap gap-1.5">
							{#each EFFECT_KEYS as fxKey}
								{@const on = !!(cfg[fxKey] as { enabled?: boolean } | undefined)?.enabled}
								<button
									type="button"
									onclick={() => toggleEffect(tab.id, fxKey)}
									class="rounded-full border px-3 py-1 text-xs font-semibold transition-all"
									class:border-zinc-700={!on}
									class:text-zinc-500={!on}
									class:hover:border-zinc-500={!on}
									class:hover:text-zinc-400={!on}
									style={on
										? 'border-color: #00e5ff44; background-color: #00e5ff18; color: #00e5ff;'
										: ''}
								>
									{EFFECT_LABELS[fxKey]}
								</button>
							{/each}
						</div>
					</div>

					<!-- 5. Expanded control cards for enabled effects only -->
					{#if anyEnabled}
						<div class="mb-4 space-y-2">
							<!-- Pitch -->
							{#if pitchOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Pitch</span>
										<span class="font-mono text-xs text-zinc-500">
											{pitchOf(cfg).semitones > 0 ? '+' : ''}{pitchOf(cfg).semitones} st
										</span>
									</div>
									<input
										type="range"
										min="-12"
										max="12"
										step="1"
										class="w-full accent-[#00e5ff]"
										value={pitchOf(cfg).semitones}
										oninput={(e) => {
											tabEffects[tab.id] = {
												...cfg,
												pitch: {
													...pitchOf(cfg),
													semitones: Number((e.target as HTMLInputElement).value)
												}
											};
											schedSave(tab.id);
										}}
									/>
								</div>
							{/if}

							<!-- Tempo -->
							{#if tempoOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Tempo</span>
										<span class="font-mono text-xs text-zinc-500">{tempoOf(cfg).rate.toFixed(2)}×</span>
									</div>
									<input
										type="range"
										min="0.5"
										max="2.0"
										step="0.05"
										class="w-full accent-[#00e5ff]"
										value={tempoOf(cfg).rate}
										oninput={(e) => {
											tabEffects[tab.id] = {
												...cfg,
												tempo: {
													...tempoOf(cfg),
													rate: Number((e.target as HTMLInputElement).value)
												}
											};
											schedSave(tab.id);
										}}
									/>
								</div>
							{/if}

							<!-- Lowpass -->
							{#if lowpassOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Lowpass</span>
										<span class="font-mono text-xs text-zinc-500"
											>{lowpassOf(cfg).cutoff_hz.toFixed(0)} Hz</span
										>
									</div>
									<input
										type="range"
										min="100"
										max="15000"
										step="100"
										class="w-full accent-[#00e5ff]"
										value={lowpassOf(cfg).cutoff_hz}
										oninput={(e) => {
											tabEffects[tab.id] = {
												...cfg,
												lowpass: {
													...lowpassOf(cfg),
													cutoff_hz: Number((e.target as HTMLInputElement).value)
												}
											};
											schedSave(tab.id);
										}}
									/>
								</div>
							{/if}

							<!-- Highpass -->
							{#if highpassOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Highpass</span>
										<span class="font-mono text-xs text-zinc-500"
											>{highpassOf(cfg).cutoff_hz.toFixed(0)} Hz</span
										>
									</div>
									<input
										type="range"
										min="20"
										max="8000"
										step="20"
										class="w-full accent-[#00e5ff]"
										value={highpassOf(cfg).cutoff_hz}
										oninput={(e) => {
											tabEffects[tab.id] = {
												...cfg,
												highpass: {
													...highpassOf(cfg),
													cutoff_hz: Number((e.target as HTMLInputElement).value)
												}
											};
											schedSave(tab.id);
										}}
									/>
								</div>
							{/if}

							<!-- Bandpass -->
							{#if bandpassOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Bandpass</span>
										<span class="font-mono text-xs text-zinc-500">
											{bandpassOf(cfg).freq_hz.toFixed(0)} Hz · Q
											{bandpassOf(cfg).q.toFixed(1)}
										</span>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Frequency</span>
											<input
												type="range"
												min="100"
												max="10000"
												step="100"
												class="w-full accent-[#00e5ff]"
												value={bandpassOf(cfg).freq_hz}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														bandpass: {
															...bandpassOf(cfg),
															freq_hz: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Q (resonance)</span>
											<input
												type="range"
												min="0.1"
												max="10"
												step="0.1"
												class="w-full accent-[#00e5ff]"
												value={bandpassOf(cfg).q}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														bandpass: {
															...bandpassOf(cfg),
															q: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
								</div>
							{/if}

							<!-- Phaser -->
							{#if phaserOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Phaser</span>
										<span class="font-mono text-xs text-zinc-500">
											{phaserOf(cfg).rate_hz.toFixed(2)} Hz · d
											{phaserOf(cfg).depth.toFixed(2)}
										</span>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Rate</span>
											<input
												type="range"
												min="0.01"
												max="4"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={phaserOf(cfg).rate_hz}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														phaser: {
															...phaserOf(cfg),
															rate_hz: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Depth</span>
											<input
												type="range"
												min="0"
												max="1"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={phaserOf(cfg).depth}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														phaser: {
															...phaserOf(cfg),
															depth: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
								</div>
							{/if}

							<!-- Flanger (stub — audio passes through unmodified) -->
							{#if flangerOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Flanger</span>
										<span class="font-mono text-xs text-zinc-500">
											{flangerOf(cfg).rate_hz.toFixed(2)} Hz · d
											{flangerOf(cfg).depth.toFixed(2)}
										</span>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Rate</span>
											<input
												type="range"
												min="0.01"
												max="2"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={flangerOf(cfg).rate_hz}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														flanger: {
															...flangerOf(cfg),
															rate_hz: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Depth</span>
											<input
												type="range"
												min="0"
												max="1"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={flangerOf(cfg).depth}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														flanger: {
															...flangerOf(cfg),
															depth: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
									<p class="mt-2 text-xs text-zinc-600 italic">Stub — not yet wired</p>
								</div>
							{/if}
						</div>
					{/if}

					<!-- 6. WET preview — Waveform with live effects applied -->
					{#if previewClip}
						<div class="rounded-lg border p-3" style="border-color: #00e5ff22; background-color: #00e5ff06;">
							<div class="mb-2 flex items-center gap-2">
								<span class="text-xs font-semibold" style="color: #00e5ff;">Processed (wet)</span>
								{#if !anyEnabled}
									<span class="text-xs text-zinc-600 italic">enable an effect to hear the chain</span>
								{/if}
								<button
									type="button"
									onclick={() => wetRefs[tab.id]?.playPause()}
									class="ml-auto rounded border px-2.5 py-0.5 text-xs font-semibold transition-colors"
									style={wetPlaying[tab.id]
										? 'color: #00e5ff; border-color: #00e5ff44;'
										: 'color: #71717a; border-color: #3f3f46;'}
								>
									{wetPlaying[tab.id] ? '⏸ Pause' : '▶ Play'}
								</button>
							</div>
							<Waveform
								bind:this={wetRefs[tab.id]}
								src={previewClip.storage_path}
								effects={tabEffects[tab.id]}
								waveColor="#1e3a3a"
								progressColor="#00e5ff"
								height={40}
								onPlayStateChange={(playing) => {
									wetPlaying[tab.id] = playing;
								}}
							/>
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
