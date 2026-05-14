<script lang="ts">
	import { enhance } from '$app/forms';
	import { TYPE_FIELDS } from '$lib/variants';
	import type { EffectsConfig } from '$lib/types/index.js';

	type Tab = { id: string; position: number; effects?: unknown };

	let {
		tabs,
		pointsConfig,
		fieldModes: savedFieldModes
	}: {
		tabs: Tab[];
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

				<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
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

					<!-- Effects chain -->
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<!-- Pitch -->
						<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
							<div class="mb-2 flex items-center gap-2">
								<input
									type="checkbox"
									id="pitch-en-{tab.id}"
									class="accent-amber-400"
									checked={pitchOf(cfg).enabled}
									onchange={(e) => {
										tabEffects[tab.id] = {
											...cfg,
											pitch: { ...pitchOf(cfg), enabled: (e.target as HTMLInputElement).checked }
										};
										schedSave(tab.id);
									}}
								/>
								<label for="pitch-en-{tab.id}" class="text-xs font-semibold text-zinc-300"
									>Pitch</label
								>
								<span class="ml-auto font-mono text-xs text-zinc-500">
									{pitchOf(cfg).semitones > 0 ? '+' : ''}{pitchOf(cfg).semitones} st
								</span>
							</div>
							<input
								type="range"
								min="-12"
								max="12"
								step="1"
								class="w-full accent-amber-400"
								disabled={!pitchOf(cfg).enabled}
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

						<!-- Tempo -->
						<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
							<div class="mb-2 flex items-center gap-2">
								<input
									type="checkbox"
									id="tempo-en-{tab.id}"
									class="accent-amber-400"
									checked={tempoOf(cfg).enabled}
									onchange={(e) => {
										tabEffects[tab.id] = {
											...cfg,
											tempo: { ...tempoOf(cfg), enabled: (e.target as HTMLInputElement).checked }
										};
										schedSave(tab.id);
									}}
								/>
								<label for="tempo-en-{tab.id}" class="text-xs font-semibold text-zinc-300"
									>Tempo</label
								>
								<span class="ml-auto font-mono text-xs text-zinc-500">
									{tempoOf(cfg).rate.toFixed(2)}×
								</span>
							</div>
							<input
								type="range"
								min="0.5"
								max="2.0"
								step="0.05"
								class="w-full accent-amber-400"
								disabled={!tempoOf(cfg).enabled}
								value={tempoOf(cfg).rate}
								oninput={(e) => {
									tabEffects[tab.id] = {
										...cfg,
										tempo: { ...tempoOf(cfg), rate: Number((e.target as HTMLInputElement).value) }
									};
									schedSave(tab.id);
								}}
							/>
						</div>

						<!-- Lowpass -->
						<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
							<div class="mb-2 flex items-center gap-2">
								<input
									type="checkbox"
									id="lp-en-{tab.id}"
									class="accent-amber-400"
									checked={lowpassOf(cfg).enabled}
									onchange={(e) => {
										tabEffects[tab.id] = {
											...cfg,
											lowpass: {
												...lowpassOf(cfg),
												enabled: (e.target as HTMLInputElement).checked
											}
										};
										schedSave(tab.id);
									}}
								/>
								<label for="lp-en-{tab.id}" class="text-xs font-semibold text-zinc-300"
									>Lowpass</label
								>
								<span class="ml-auto font-mono text-xs text-zinc-500">
									{lowpassOf(cfg).cutoff_hz.toFixed(0)} Hz
								</span>
							</div>
							<input
								type="range"
								min="100"
								max="15000"
								step="100"
								class="w-full accent-amber-400"
								disabled={!lowpassOf(cfg).enabled}
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

						<!-- Highpass -->
						<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
							<div class="mb-2 flex items-center gap-2">
								<input
									type="checkbox"
									id="hp-en-{tab.id}"
									class="accent-amber-400"
									checked={highpassOf(cfg).enabled}
									onchange={(e) => {
										tabEffects[tab.id] = {
											...cfg,
											highpass: {
												...highpassOf(cfg),
												enabled: (e.target as HTMLInputElement).checked
											}
										};
										schedSave(tab.id);
									}}
								/>
								<label for="hp-en-{tab.id}" class="text-xs font-semibold text-zinc-300"
									>Highpass</label
								>
								<span class="ml-auto font-mono text-xs text-zinc-500">
									{highpassOf(cfg).cutoff_hz.toFixed(0)} Hz
								</span>
							</div>
							<input
								type="range"
								min="20"
								max="8000"
								step="20"
								class="w-full accent-amber-400"
								disabled={!highpassOf(cfg).enabled}
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

						<!-- Bandpass -->
						<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
							<div class="mb-2 flex items-center gap-2">
								<input
									type="checkbox"
									id="bp-en-{tab.id}"
									class="accent-amber-400"
									checked={bandpassOf(cfg).enabled}
									onchange={(e) => {
										tabEffects[tab.id] = {
											...cfg,
											bandpass: {
												...bandpassOf(cfg),
												enabled: (e.target as HTMLInputElement).checked
											}
										};
										schedSave(tab.id);
									}}
								/>
								<label for="bp-en-{tab.id}" class="text-xs font-semibold text-zinc-300"
									>Bandpass</label
								>
								<span class="ml-auto font-mono text-xs text-zinc-500">
									{bandpassOf(cfg).freq_hz.toFixed(0)} Hz Q={bandpassOf(cfg).q.toFixed(1)}
								</span>
							</div>
							<div class="space-y-1">
								<input
									type="range"
									min="100"
									max="10000"
									step="100"
									class="w-full accent-amber-400"
									disabled={!bandpassOf(cfg).enabled}
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
								<input
									type="range"
									min="0.1"
									max="10"
									step="0.1"
									class="w-full accent-amber-400"
									disabled={!bandpassOf(cfg).enabled}
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

						<!-- Phaser -->
						<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
							<div class="mb-2 flex items-center gap-2">
								<input
									type="checkbox"
									id="ph-en-{tab.id}"
									class="accent-amber-400"
									checked={phaserOf(cfg).enabled}
									onchange={(e) => {
										tabEffects[tab.id] = {
											...cfg,
											phaser: { ...phaserOf(cfg), enabled: (e.target as HTMLInputElement).checked }
										};
										schedSave(tab.id);
									}}
								/>
								<label for="ph-en-{tab.id}" class="text-xs font-semibold text-zinc-300"
									>Phaser</label
								>
								<span class="ml-auto font-mono text-xs text-zinc-500">
									{phaserOf(cfg).rate_hz.toFixed(2)} Hz d={phaserOf(cfg).depth.toFixed(2)}
								</span>
							</div>
							<div class="space-y-1">
								<input
									type="range"
									min="0.01"
									max="4"
									step="0.01"
									class="w-full accent-amber-400"
									disabled={!phaserOf(cfg).enabled}
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
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									class="w-full accent-amber-400"
									disabled={!phaserOf(cfg).enabled}
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

						<!-- Flanger -->
						<div class="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
							<div class="mb-2 flex items-center gap-2">
								<input
									type="checkbox"
									id="fl-en-{tab.id}"
									class="accent-amber-400"
									checked={flangerOf(cfg).enabled}
									onchange={(e) => {
										tabEffects[tab.id] = {
											...cfg,
											flanger: {
												...flangerOf(cfg),
												enabled: (e.target as HTMLInputElement).checked
											}
										};
										schedSave(tab.id);
									}}
								/>
								<label for="fl-en-{tab.id}" class="text-xs font-semibold text-zinc-300"
									>Flanger</label
								>
								<span class="ml-auto font-mono text-xs text-zinc-500">
									{flangerOf(cfg).rate_hz.toFixed(2)} Hz d={flangerOf(cfg).depth.toFixed(2)}
								</span>
							</div>
							<div class="space-y-1">
								<input
									type="range"
									min="0.01"
									max="2"
									step="0.01"
									class="w-full accent-amber-400"
									disabled={!flangerOf(cfg).enabled}
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
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									class="w-full accent-amber-400"
									disabled={!flangerOf(cfg).enabled}
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
					</div>
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
