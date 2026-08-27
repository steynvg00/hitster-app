<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
	import type { EffectsConfig, EffectPreset } from '$lib/types/index.js';
	import { BUILTIN_PRESETS } from '$lib/effects-presets.js';
	import {
		TEMPO_RATE_MIN,
		TEMPO_RATE_MAX,
		TEMPO_RATE_STEP,
		TEMPO_RATE_DEFAULT,
		clampTempoRate
	} from '$lib/audio-limits.js';
	import SearchablePicker from '$lib/components/admin/SearchablePicker.svelte';
	import Waveform from '$lib/components/ui/Waveform.svelte';

	type Track = { id: string; artist: string; title: string; year: number };
	type Clip = {
		id: string;
		track_id: string;
		storage_path: string;
		storage_object_path: string | null;
		duration: number | null;
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
		userPresets = []
	}: {
		tabs: Tab[];
		sourceTracksByTab: Src[];
		clipsByTab: TabClip[];
		allTracks: Track[];
		clips: Clip[];
		userPresets?: EffectPreset[];
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
		if (dur == null) return null;
		return `${Math.floor(dur / 60)}:${String(Math.round(dur % 60)).padStart(2, '0')}`;
	}

	/**
	 * Welke clip van de tab in de dry/wet-preview staat, per tab-id.
	 *
	 * Een tab draagt nu 1-N clips maar houdt ÉÉN effectketen, dus één Waveform
	 * per tab volstaat; deze index bepaalt alleen welke clip daar doorheen gaat.
	 * Buiten bereik (clip verwijderd) wordt bij het renderen geklemd.
	 */
	let previewIdx = $state<Record<string, number>>({});

	/**
	 * Losse afspeelknopjes in de cliplijst — één tegelijk, precies zoals de
	 * lijst in StandardEditor en FragmentsEditor. Dit staat naast de
	 * Waveform-previews: die horen bij de effectketen, deze bij het opbouwen
	 * van de lijst.
	 */
	let playingClipId = $state<string | null>(null);
	const audioEls: Record<string, HTMLAudioElement> = {};

	function playPreview(clipId: string) {
		if (playingClipId && playingClipId !== clipId && audioEls[playingClipId]) {
			audioEls[playingClipId].pause();
			audioEls[playingClipId].currentTime = 0;
		}
		const el = audioEls[clipId];
		if (!el) return;
		if (playingClipId === clipId) {
			el.pause();
			el.currentTime = 0;
			playingClipId = null;
		} else {
			void el.play();
			playingClipId = clipId;
		}
	}

	// ── Accessor functions — return cfg value or full-default object ──────────────
	function pitchOf(cfg: EffectsConfig) {
		return cfg.pitch ?? { enabled: false, semitones: 0, window_size: 0.1 };
	}
	function tempoOf(cfg: EffectsConfig) {
		return cfg.tempo ?? { enabled: false, rate: TEMPO_RATE_DEFAULT };
	}
	function lowpassOf(cfg: EffectsConfig) {
		return cfg.lowpass ?? { enabled: false, cutoff_hz: 2000, q: 1.0 };
	}
	function highpassOf(cfg: EffectsConfig) {
		return cfg.highpass ?? { enabled: false, cutoff_hz: 200, q: 1.0 };
	}
	function bandpassOf(cfg: EffectsConfig) {
		return cfg.bandpass ?? { enabled: false, freq_hz: 1000, q: 1.0, mod_rate_hz: 0 };
	}
	function phaserOf(cfg: EffectsConfig) {
		return (
			cfg.phaser ?? {
				enabled: false,
				rate_hz: 0.5,
				depth: 0.5,
				stages: 4,
				feedback: 0.5
			}
		);
	}
	function flangerOf(cfg: EffectsConfig) {
		return cfg.flanger ?? { enabled: false, rate_hz: 0.25, depth: 0.5, feedback: 0.3 };
	}
	function bitcrusherOf(cfg: EffectsConfig) {
		return cfg.bitcrusher ?? { enabled: false, bits: 8 };
	}
	function ringModOf(cfg: EffectsConfig) {
		return cfg.ring_mod ?? { enabled: false, freq_hz: 30, depth: 1 };
	}
	function delayOf(cfg: EffectsConfig) {
		return cfg.delay ?? { enabled: false, time_ms: 250, feedback: 0.3, wet: 0.3 };
	}
	function reverbOf(cfg: EffectsConfig) {
		return cfg.reverb ?? { enabled: false, decay_s: 2, pre_delay_ms: 20, wet: 0.5 };
	}
	function reverseOf(cfg: EffectsConfig) {
		return cfg.reverse ?? { enabled: false };
	}

	// ── Local effects state per tab ───────────────────────────────────────────────
	let tabEffects = $state<Record<string, EffectsConfig>>(
		Object.fromEntries(tabs.map((t) => [t.id, (t.effects as EffectsConfig) ?? {}]))
	);

	let saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
	// Per-tab save status, surfaced in the tab header. 'error' offers a retry so a
	// failed ?/saveTabEffects can't silently drop the host's edit.
	let saveState = $state<Record<string, 'saving' | 'saved' | 'error' | undefined>>({});
	let activeTabIdx = $state(0);
	// Tabs whose latest edit hasn't been confirmed saved — flushed on navigation/unload
	// so a debounce still pending at nav time isn't lost.
	const dirtyTabs = new Set<string>();

	function schedSave(tabId: string) {
		dirtyTabs.add(tabId);
		clearTimeout(saveTimers[tabId]);
		saveTimers[tabId] = setTimeout(() => doSave(tabId), 600);
	}

	async function doSave(tabId: string) {
		saveState[tabId] = 'saving';
		try {
			const fd = new FormData();
			fd.append('tab_id', tabId);
			fd.append('effects_json', JSON.stringify(tabEffects[tabId]));
			const res = await fetch('?/saveTabEffects', { method: 'POST', body: fd });
			if (!res.ok) throw new Error(`save failed: ${res.status}`);
			dirtyTabs.delete(tabId);
			saveState[tabId] = 'saved';
		} catch {
			// Keep the tab dirty so the unload flush still tries, and expose a retry.
			saveState[tabId] = 'error';
		}
	}

	// Flush any pending/failed edit immediately. sendBeacon survives page unload
	// (a plain fetch would be cancelled); it's fire-and-forget, which is exactly
	// what a last-ditch save needs. The 600ms debounce timer is cleared first so
	// we don't double-send.
	function flushPending() {
		for (const tabId of dirtyTabs) {
			clearTimeout(saveTimers[tabId]);
			const fd = new FormData();
			fd.append('tab_id', tabId);
			fd.append('effects_json', JSON.stringify(tabEffects[tabId]));
			navigator.sendBeacon('?/saveTabEffects', fd);
		}
		dirtyTabs.clear();
	}

	function handleBeforeUnload() {
		if (dirtyTabs.size) flushPending();
	}

	onMount(() => {
		window.addEventListener('beforeunload', handleBeforeUnload);
	});

	onDestroy(() => {
		// Client-side navigation away: no unload event fires, so flush here too.
		if (typeof window !== 'undefined') {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			if (dirtyTabs.size) flushPending();
		}
	});

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
			case 'bitcrusher':
				tabEffects[tabId] = {
					...cfg,
					bitcrusher: { ...bitcrusherOf(cfg), enabled: !bitcrusherOf(cfg).enabled }
				};
				break;
			case 'ring_mod':
				tabEffects[tabId] = {
					...cfg,
					ring_mod: { ...ringModOf(cfg), enabled: !ringModOf(cfg).enabled }
				};
				break;
			case 'delay':
				tabEffects[tabId] = { ...cfg, delay: { ...delayOf(cfg), enabled: !delayOf(cfg).enabled } };
				break;
			case 'reverb':
				tabEffects[tabId] = {
					...cfg,
					reverb: { ...reverbOf(cfg), enabled: !reverbOf(cfg).enabled }
				};
				break;
			case 'reverse':
				tabEffects[tabId] = { ...cfg, reverse: { enabled: !reverseOf(cfg).enabled } };
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
		'flanger',
		'bitcrusher',
		'ring_mod',
		'delay',
		'reverb',
		'reverse'
	];

	const EFFECT_LABELS: Record<keyof EffectsConfig, string> = {
		pitch: 'Pitch',
		tempo: 'Tempo',
		lowpass: 'Lowpass',
		highpass: 'Highpass',
		bandpass: 'Bandpass',
		phaser: 'Phaser',
		flanger: 'Flanger',
		bitcrusher: 'Bitcrusher',
		ring_mod: 'Ring Mod',
		delay: 'Delay',
		reverb: 'Reverb',
		reverse: 'Reverse'
	};

	// ── Preset UI state (per-tab) ─────────────────────────────────────────────────
	let tabPresetSelected = $state<Record<string, string>>({});
	let tabShowSavePreset = $state<Record<string, boolean>>({});
	let tabPresetSaveName = $state<Record<string, string>>({});
	let tabShowManagePresets = $state<Record<string, boolean>>({});

	function applyPreset(tabId: string) {
		const presetId = tabPresetSelected[tabId];
		if (!presetId) return;
		const preset =
			BUILTIN_PRESETS.find((p) => p.id === presetId) ?? userPresets.find((p) => p.id === presetId);
		if (!preset) return;
		const cfg = tabEffects[tabId] ?? {};
		const anyEnabled = EFFECT_KEYS.some(
			(k) => !!(cfg[k] as { enabled?: boolean } | undefined)?.enabled
		);
		if (anyEnabled && !confirm(`Apply "${preset.name}"? This will replace all current effects.`)) {
			return;
		}
		tabEffects[tabId] = { ...preset.effects };
		schedSave(tabId);
	}

	// ── WET preview ───────────────────────────────────────────────────────────────
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
		<!-- Tab pills — the tab navigation. Sets the SAME activeTabIdx the card's
		     own hidden-binding below reads: same state, same handler as the in-card
		     header, no second source of truth. Active pill reuses this page's own
		     STATUS-pill treatment (bg-amber-400 + zinc-950 text) so the two agree. -->
		<div class="mb-3 flex flex-wrap gap-2">
			{#each tabs as tab, tabIdx (tab.id)}
				<button
					type="button"
					onclick={() => (activeTabIdx = tabIdx)}
					class="rounded-lg px-4 py-2 text-sm font-semibold transition-colors {activeTabIdx ===
					tabIdx
						? 'bg-amber-400 text-zinc-950'
						: 'border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white'}"
				>
					Tab {tabIdx + 1}
				</button>
			{/each}
		</div>

		<div class="space-y-4">
			{#each tabs as tab, tabIdx (tab.id)}
				{@const cfg = tabEffects[tab.id] ?? {}}
				{@const srcs = srcsForTab(tab.id)}
				{@const tabClips = clipsForTab(tab.id)}
				{@const src = srcs[0]}
				{@const pIdx = Math.min(previewIdx[tab.id] ?? 0, Math.max(0, tabClips.length - 1))}
				{@const previewTc = tabClips[pIdx]}
				{@const previewClip = previewTc
					? (clips.find((c) => c.id === previewTc.clip_id) ?? null)
					: null}
				{@const anyEnabled = EFFECT_KEYS.some(
					(k) => !!(cfg[k] as { enabled?: boolean } | undefined)?.enabled
				)}
				{@const reverseOn = reverseOf(cfg).enabled}

				<div
					class="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
					hidden={activeTabIdx !== tabIdx}
				>
					<!-- Tab header -->
					<div class="mb-4 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={() => (activeTabIdx = tabIdx)}
								class="text-xs font-bold tracking-widest uppercase transition-colors {activeTabIdx ===
								tabIdx
									? 'text-amber-400'
									: 'text-zinc-500 hover:text-zinc-300'}"
							>
								Tab {tabIdx + 1}
							</button>
							{#if saveState[tab.id] === 'saving'}
								<span class="text-xs text-zinc-500">Saving…</span>
							{:else if saveState[tab.id] === 'saved'}
								<span class="text-xs text-zinc-600">Saved</span>
							{:else if saveState[tab.id] === 'error'}
								<span class="text-xs text-red-400">Save failed</span>
								<button
									type="button"
									onclick={() => doSave(tab.id)}
									class="text-xs font-semibold text-amber-400 hover:text-amber-300"
								>
									Retry
								</button>
							{/if}
						</div>
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

					<!-- 2. Clips (1-N per tab, geordend) — zelfde rij als StandardEditor.
					     De effectketen hieronder hoort bij de TAB, niet bij een losse clip:
					     de loader geeft elke clip van de tab dezelfde `effects` mee, dus wat
					     hier staat ingesteld geldt voor alles in deze lijst. -->
					<div class="mb-3">
						<span class="mb-2 block text-xs font-semibold text-zinc-400"
							>Clips ({tabClips.length})</span
						>
						{#if !src?.track_id}
							<p class="text-xs text-zinc-600 italic">Pick a track first</p>
						{:else}
							{#if tabClips.length === 0}
								<p class="mb-2 text-xs text-zinc-600 italic">No clips yet.</p>
							{:else}
								<div class="mb-2 space-y-1.5">
									{#each tabClips as tc, ci (tc.id)}
										{@const c = clips.find((cc) => cc.id === tc.clip_id)}
										<div class="flex items-center gap-2 rounded bg-zinc-800 px-3 py-2 text-xs">
											<span
												class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[10px] font-black text-zinc-950"
											>
												{ci + 1}
											</span>
											<span class="flex-1 text-zinc-300">
												{c ? (c.storage_path.split('/').pop() ?? 'clip') : 'unknown clip'}
												{#if c?.duration}
													<span class="ml-1 text-zinc-500">{formatDur(c.duration)}</span>
												{/if}
											</span>
											<!-- Welke clip door de effectketen hieronder gaat. Eén Waveform per
											     tab: de keten is tab-breed, dus dit kiest alleen wat je hoort. -->
											<button
												type="button"
												onclick={() => (previewIdx[tab.id] = ci)}
												class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors
													{pIdx === ci ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}"
												title="Use this clip in the dry/wet preview">FX</button
											>
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

							<!-- Toevoegen — beperkt tot de brontrack van deze tab, en clips die er al
							     in zitten vallen weg zodat dezelfde clip niet twee keer in de lijst
							     belandt. Gekeyed op het aantal zodat de picker na elke toevoeging
							     leeg terugkomt, net als in StandardEditor en FragmentsEditor. -->
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
												label: c.storage_path.split('/').pop() ?? 'Clip',
												subtitle: formatDur(c.duration) ?? ''
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

					<!-- 3. DRY preview van de clip die op FX staat -->
					{#if previewClip}
						<div class="mb-4">
							<span class="text-xs text-zinc-600">
								Original (dry){#if tabClips.length > 1}
									<span class="text-zinc-500"> — clip {pIdx + 1} of {tabClips.length}</span>
								{/if}
							</span>
							{#key previewClip.id}
								<audio
									controls
									crossorigin="anonymous"
									src={previewClip.storage_path}
									class="mt-1 h-8 w-full rounded"
								></audio>
							{/key}
						</div>
					{/if}

					<!-- 4. Preset picker -->
					<div class="mb-3 rounded-lg border border-zinc-700/50 bg-zinc-800/40 p-3">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-xs font-semibold text-zinc-400">Presets</span>
							<div class="flex gap-1.5">
								<button
									type="button"
									onclick={() => (tabShowManagePresets[tab.id] = !tabShowManagePresets[tab.id])}
									class="text-xs text-zinc-600 hover:text-zinc-400"
								>
									{tabShowManagePresets[tab.id] ? 'Hide manage' : 'Manage'}
								</button>
							</div>
						</div>
						<div class="flex gap-2">
							<select
								class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-white"
								bind:value={tabPresetSelected[tab.id]}
							>
								<option value="">— select a preset —</option>
								<optgroup label="Built-in">
									{#each BUILTIN_PRESETS as preset}
										<option value={preset.id}>{preset.name}</option>
									{/each}
								</optgroup>
								{#if userPresets.length > 0}
									<optgroup label="My presets">
										{#each userPresets as preset}
											<option value={preset.id}>{preset.name}</option>
										{/each}
									</optgroup>
								{/if}
							</select>
							<button
								type="button"
								onclick={() => applyPreset(tab.id)}
								disabled={!tabPresetSelected[tab.id]}
								class="rounded border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
							>
								Apply
							</button>
						</div>

						<!-- Save as preset -->
						<div class="mt-2">
							{#if tabShowSavePreset[tab.id]}
								<form
									method="POST"
									action="?/savePreset"
									use:enhance={() =>
										async ({ update }) => {
											tabShowSavePreset[tab.id] = false;
											tabPresetSaveName[tab.id] = '';
											await update();
										}}
									class="flex gap-2"
								>
									<input type="hidden" name="effects_json" value={JSON.stringify(cfg)} />
									<input
										type="text"
										name="name"
										bind:value={tabPresetSaveName[tab.id]}
										placeholder="Preset name…"
										required
										class="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white placeholder-zinc-600"
									/>
									<button
										type="submit"
										class="rounded border border-amber-600 px-3 py-1 text-xs font-semibold text-amber-400 hover:border-amber-400"
									>
										Save
									</button>
									<button
										type="button"
										onclick={() => (tabShowSavePreset[tab.id] = false)}
										class="text-xs text-zinc-600 hover:text-zinc-400"
									>
										Cancel
									</button>
								</form>
							{:else}
								<button
									type="button"
									onclick={() => (tabShowSavePreset[tab.id] = true)}
									class="text-xs text-zinc-600 hover:text-zinc-400"
								>
									+ Save current as preset
								</button>
							{/if}
						</div>

						<!-- Manage user presets -->
						{#if tabShowManagePresets[tab.id] && userPresets.length > 0}
							<div class="mt-3 space-y-1.5 border-t border-zinc-700 pt-2">
								{#each userPresets as preset}
									<div class="flex items-center gap-2">
										<span class="flex-1 truncate text-xs text-zinc-300">{preset.name}</span>
										<form method="POST" action="?/deletePreset" use:enhance class="inline">
											<input type="hidden" name="preset_id" value={preset.id} />
											<button
												type="submit"
												onclick={(e) => {
													if (!confirm(`Delete preset "${preset.name}"?`)) e.preventDefault();
												}}
												class="text-xs text-red-700 hover:text-red-400">Delete</button
											>
										</form>
									</div>
								{/each}
							</div>
						{:else if tabShowManagePresets[tab.id]}
							<p class="mt-2 text-xs text-zinc-600 italic">No saved presets yet.</p>
						{/if}
					</div>

					<!-- 5. Toggle pill row -->
					<div class="mb-3">
						<span class="mb-2 block text-xs text-zinc-500">Effects</span>
						<div class="flex flex-wrap gap-1.5">
							{#each EFFECT_KEYS as fxKey}
								{@const on = !!(cfg[fxKey] as { enabled?: boolean } | undefined)?.enabled}
								{@const isReverse = fxKey === 'reverse'}
								{@const disabledByReverse = reverseOn && !isReverse}
								<button
									type="button"
									onclick={() => toggleEffect(tab.id, fxKey)}
									disabled={disabledByReverse}
									class="rounded-full border px-3 py-1 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30"
									class:border-zinc-700={!on && !disabledByReverse}
									class:text-zinc-500={!on && !disabledByReverse}
									class:hover:border-zinc-500={!on && !disabledByReverse}
									class:hover:text-zinc-400={!on && !disabledByReverse}
									style={on && isReverse
										? 'border-color: #ff7f1144; background-color: #ff7f1118; color: #ff7f11;'
										: on
											? 'border-color: #00e5ff44; background-color: #00e5ff18; color: #00e5ff;'
											: ''}
								>
									{EFFECT_LABELS[fxKey]}
								</button>
							{/each}
						</div>
						{#if reverseOn}
							<p class="mt-2 text-xs" style="color: #ff7f11;">
								Reverse mode — other effects are disabled while Reverse is active
							</p>
						{/if}
					</div>

					<!-- 6. Control cards for enabled effects -->
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
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Semitones (−24 to +24)</span>
											<input
												type="range"
												min="-24"
												max="24"
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
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Window size ({pitchOf(cfg).window_size.toFixed(2)} s)</span
											>
											<input
												type="range"
												min="0.03"
												max="0.5"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={pitchOf(cfg).window_size}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														pitch: {
															...pitchOf(cfg),
															window_size: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
								</div>
							{/if}

							<!-- Tempo -->
							{#if tempoOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Tempo</span>
										<span class="font-mono text-xs text-zinc-500"
											>{clampTempoRate(tempoOf(cfg).rate).toFixed(2)}×</span
										>
									</div>
									<!-- Range bounded by what the pitch correction can deliver cleanly, not by
									     what playbackRate accepts — see $lib/audio-limits. The displayed value is
									     clamped too, so a legacy out-of-range rate reads as what will actually
									     play rather than as its (unchanged) stored value. -->
									<input
										type="range"
										min={TEMPO_RATE_MIN}
										max={TEMPO_RATE_MAX}
										step={TEMPO_RATE_STEP}
										class="w-full accent-[#00e5ff]"
										value={clampTempoRate(tempoOf(cfg).rate)}
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
											>{lowpassOf(cfg).cutoff_hz.toFixed(0)} Hz · Q {lowpassOf(cfg).q.toFixed(
												1
											)}</span
										>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Cutoff</span>
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
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Q (resonance)</span>
											<input
												type="range"
												min="0.1"
												max="10"
												step="0.1"
												class="w-full accent-[#00e5ff]"
												value={lowpassOf(cfg).q}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														lowpass: {
															...lowpassOf(cfg),
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

							<!-- Highpass -->
							{#if highpassOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Highpass</span>
										<span class="font-mono text-xs text-zinc-500"
											>{highpassOf(cfg).cutoff_hz.toFixed(0)} Hz · Q {highpassOf(cfg).q.toFixed(
												1
											)}</span
										>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Cutoff</span>
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
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Q (resonance)</span>
											<input
												type="range"
												min="0.1"
												max="10"
												step="0.1"
												class="w-full accent-[#00e5ff]"
												value={highpassOf(cfg).q}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														highpass: {
															...highpassOf(cfg),
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

							<!-- Bandpass -->
							{#if bandpassOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Bandpass</span>
										<span class="font-mono text-xs text-zinc-500">
											{bandpassOf(cfg).freq_hz.toFixed(0)} Hz · Q {bandpassOf(cfg).q.toFixed(1)}
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
											<span class="mb-0.5 block text-xs text-zinc-600">Q</span>
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
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Mod rate ({bandpassOf(cfg).mod_rate_hz.toFixed(2)} Hz — 0 = static)</span
											>
											<input
												type="range"
												min="0"
												max="4"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={bandpassOf(cfg).mod_rate_hz}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														bandpass: {
															...bandpassOf(cfg),
															mod_rate_hz: Number((e.target as HTMLInputElement).value)
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
											{phaserOf(cfg).rate_hz.toFixed(2)} Hz · d {phaserOf(cfg).depth.toFixed(2)}
										</span>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Rate</span>
											<input
												type="range"
												min="0.01"
												max="8"
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
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Stages ({phaserOf(cfg).stages})</span
											>
											<input
												type="range"
												min="2"
												max="12"
												step="2"
												class="w-full accent-[#00e5ff]"
												value={phaserOf(cfg).stages}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														phaser: {
															...phaserOf(cfg),
															stages: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Feedback ({phaserOf(cfg).feedback.toFixed(2)})</span
											>
											<input
												type="range"
												min="0"
												max="0.95"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={phaserOf(cfg).feedback}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														phaser: {
															...phaserOf(cfg),
															feedback: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
								</div>
							{/if}

							<!-- Flanger -->
							{#if flangerOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Flanger</span>
										<span class="font-mono text-xs text-zinc-500">
											{flangerOf(cfg).rate_hz.toFixed(2)} Hz · d {flangerOf(cfg).depth.toFixed(2)}
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
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Feedback ({flangerOf(cfg).feedback.toFixed(2)})</span
											>
											<input
												type="range"
												min="0"
												max="0.95"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={flangerOf(cfg).feedback}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														flanger: {
															...flangerOf(cfg),
															feedback: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
								</div>
							{/if}

							<!-- Bitcrusher -->
							{#if bitcrusherOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Bitcrusher</span>
										<span class="font-mono text-xs text-zinc-500"
											>{bitcrusherOf(cfg).bits} bits</span
										>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Bit depth (1–16)</span>
											<input
												type="range"
												min="1"
												max="16"
												step="1"
												class="w-full accent-[#00e5ff]"
												value={bitcrusherOf(cfg).bits}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														bitcrusher: {
															...bitcrusherOf(cfg),
															bits: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
								</div>
							{/if}

							<!-- Ring Mod -->
							{#if ringModOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Ring Mod</span>
										<span class="font-mono text-xs text-zinc-500"
											>{ringModOf(cfg).freq_hz.toFixed(0)} Hz</span
										>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Frequency</span>
											<input
												type="range"
												min="1"
												max="2000"
												step="1"
												class="w-full accent-[#00e5ff]"
												value={ringModOf(cfg).freq_hz}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														ring_mod: {
															...ringModOf(cfg),
															freq_hz: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Depth ({ringModOf(cfg).depth.toFixed(2)})</span
											>
											<input
												type="range"
												min="0"
												max="1"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={ringModOf(cfg).depth}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														ring_mod: {
															...ringModOf(cfg),
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

							<!-- Delay -->
							{#if delayOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Delay</span>
										<span class="font-mono text-xs text-zinc-500"
											>{delayOf(cfg).time_ms} ms · fb {delayOf(cfg).feedback.toFixed(2)}</span
										>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Time (ms)</span>
											<input
												type="range"
												min="10"
												max="1000"
												step="10"
												class="w-full accent-[#00e5ff]"
												value={delayOf(cfg).time_ms}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														delay: {
															...delayOf(cfg),
															time_ms: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Feedback</span>
											<input
												type="range"
												min="0"
												max="0.95"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={delayOf(cfg).feedback}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														delay: {
															...delayOf(cfg),
															feedback: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Wet ({delayOf(cfg).wet.toFixed(2)})</span
											>
											<input
												type="range"
												min="0"
												max="1"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={delayOf(cfg).wet}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														delay: {
															...delayOf(cfg),
															wet: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
								</div>
							{/if}

							<!-- Reverb -->
							{#if reverbOf(cfg).enabled}
								<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
									<div class="mb-2 flex items-center justify-between">
										<span class="text-xs font-semibold text-zinc-300">Reverb</span>
										<span class="font-mono text-xs text-zinc-500"
											>{reverbOf(cfg).decay_s.toFixed(1)} s · wet {reverbOf(cfg).wet.toFixed(
												2
											)}</span
										>
									</div>
									<div class="space-y-1.5">
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600">Decay (s)</span>
											<input
												type="range"
												min="0.1"
												max="10"
												step="0.1"
												class="w-full accent-[#00e5ff]"
												value={reverbOf(cfg).decay_s}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														reverb: {
															...reverbOf(cfg),
															decay_s: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Pre-delay ({reverbOf(cfg).pre_delay_ms} ms)</span
											>
											<input
												type="range"
												min="0"
												max="200"
												step="5"
												class="w-full accent-[#00e5ff]"
												value={reverbOf(cfg).pre_delay_ms}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														reverb: {
															...reverbOf(cfg),
															pre_delay_ms: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
										<div>
											<span class="mb-0.5 block text-xs text-zinc-600"
												>Wet ({reverbOf(cfg).wet.toFixed(2)})</span
											>
											<input
												type="range"
												min="0"
												max="1"
												step="0.01"
												class="w-full accent-[#00e5ff]"
												value={reverbOf(cfg).wet}
												oninput={(e) => {
													tabEffects[tab.id] = {
														...cfg,
														reverb: {
															...reverbOf(cfg),
															wet: Number((e.target as HTMLInputElement).value)
														}
													};
													schedSave(tab.id);
												}}
											/>
										</div>
									</div>
								</div>
							{/if}

							<!-- Reverse -->
							{#if reverseOf(cfg).enabled}
								<div
									class="rounded-lg border p-3"
									style="border-color: #ff7f1133; background-color: #ff7f110a;"
								>
									<span class="text-xs font-semibold" style="color: #ff7f11;"
										>Reverse playback active</span
									>
									<p class="mt-1 text-xs text-zinc-500">
										Audio plays backwards. The WET preview below reflects this.
									</p>
								</div>
							{/if}
						</div>
					{/if}

					<!-- 7. WET preview -->
					{#if previewClip}
						<div
							class="rounded-lg border p-3"
							style="border-color: #00e5ff22; background-color: #00e5ff06;"
						>
							<div class="mb-2 flex items-center gap-2">
								<span class="text-xs font-semibold" style="color: #00e5ff;">Processed (wet)</span>
								{#if !anyEnabled}
									<span class="text-xs text-zinc-600 italic"
										>enable an effect to hear the chain</span
									>
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
							<!-- Gekeyed op de clip: Waveform geeft `url` alleen bij initialisatie
							     aan wavesurfer door, dus een gewijzigde src laadt niet vanzelf.
							     Remounten geeft ook een vers <audio>-element, wat past bij de
							     WeakMap-cache voor createMediaElementSource in Waveform. -->
							{#key previewClip.id}
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
							{/key}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>
