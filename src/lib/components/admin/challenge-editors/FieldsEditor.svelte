<script lang="ts">
	import { enhance } from '$app/forms';

	type FieldRow = { name: string; input_mode: string; max_points: number; is_bonus: boolean };
	type AnswerOption = { id: string; field: string; value: string };

	let {
		resolvedFields,
		poolBackedFields,
		answerOptions
	}: {
		resolvedFields: FieldRow[];
		poolBackedFields: string[];
		answerOptions: AnswerOption[];
	} = $props();

	// Mirrors the AnswerField union in $lib/types/index.ts — TS unions have no
	// runtime form, so this is the one hand-maintained list (previously each of
	// the 4 variant editors hand-maintained their own INPUT_MODES the same way;
	// this component is the single copy now).
	const FIELD_NAMES = [
		'artist',
		'title',
		'year',
		'label',
		'festival',
		'vocal_source',
		'grouping'
	] as const;
	const FIELD_LABELS: Record<string, string> = {
		artist: 'Artist',
		title: 'Title',
		year: 'Year',
		label: 'Label',
		festival: 'Festival',
		vocal_source: 'Vocal source',
		grouping: 'Grouping'
	};
	const INPUT_MODES = ['combobox', 'multiple_choice', 'open_text', 'slider', 'typeable_number'] as const;

	// Local editable copy — add/remove/reorder/edit happen here, then a debounced
	// save pushes the whole array (same pattern as EffectsEditor's saveTabEffects).
	let fields = $state<FieldRow[]>(resolvedFields.map((f) => ({ ...f })));
	let saveTimer: ReturnType<typeof setTimeout>;
	let saving = $state(false);
	let lastSaveOk = $state<boolean | null>(null);

	function schedSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(doSave, 600);
	}

	async function doSave() {
		saving = true;
		const fd = new FormData();
		fd.append('fields_json', JSON.stringify(fields));
		const res = await fetch('?/saveFields', { method: 'POST', body: fd });
		saving = false;
		lastSaveOk = res.ok;
	}

	function usedNames(excludeIdx: number): Set<string> {
		return new Set(fields.filter((_, i) => i !== excludeIdx).map((f) => f.name));
	}

	function availableNamesFor(idx: number): readonly string[] {
		const used = usedNames(idx);
		return FIELD_NAMES.filter((n) => !used.has(n) || n === fields[idx].name);
	}

	function canAddField(): boolean {
		const used = new Set(fields.map((f) => f.name));
		return FIELD_NAMES.some((n) => !used.has(n));
	}

	function addField() {
		const used = new Set(fields.map((f) => f.name));
		const next = FIELD_NAMES.find((n) => !used.has(n));
		if (!next) return; // all 7 known fields already added
		fields = [...fields, { name: next, input_mode: 'open_text', max_points: 10, is_bonus: false }];
		schedSave();
	}

	function removeField(idx: number) {
		fields = fields.filter((_, i) => i !== idx);
		schedSave();
	}

	function moveField(idx: number, dir: -1 | 1) {
		const target = idx + dir;
		if (target < 0 || target >= fields.length) return;
		const copy = [...fields];
		[copy[idx], copy[target]] = [copy[target], copy[idx]];
		fields = copy;
		schedSave();
	}

	function setName(idx: number, name: string) {
		// Defensive re-check even though the <select>'s options are already
		// filtered to exclude names used by other rows.
		if (fields.some((f, i) => i !== idx && f.name === name)) return;
		const row = { ...fields[idx], name };
		// A field that isn't pool-backed can't stay on combobox mode.
		if (row.input_mode === 'combobox' && !poolBackedFields.includes(name)) {
			row.input_mode = 'open_text';
		}
		fields = fields.map((f, i) => (i === idx ? row : f));
		schedSave();
	}

	function setMode(idx: number, mode: string) {
		if (mode === 'combobox' && !poolBackedFields.includes(fields[idx].name)) return;
		fields = fields.map((f, i) => (i === idx ? { ...f, input_mode: mode } : f));
		schedSave();
	}

	function setPoints(idx: number, val: number) {
		if (!Number.isFinite(val) || val < 1) return;
		fields = fields.map((f, i) => (i === idx ? { ...f, max_points: val } : f));
		schedSave();
	}

	function toggleBonus(idx: number) {
		fields = fields.map((f, i) => (i === idx ? { ...f, is_bonus: !f.is_bonus } : f));
		schedSave();
	}

	function optionsFor(field: string): string[] {
		return answerOptions.filter((o) => o.field === field).map((o) => o.value);
	}
</script>

<section>
	<div class="mb-1 flex items-center justify-between">
		<h2 class="text-sm font-bold tracking-widest text-amber-400 uppercase">Answer Fields</h2>
		<span class="text-xs text-zinc-500">
			{#if saving}Saving…{:else if lastSaveOk === true}Saved{:else if lastSaveOk === false}<span
					class="text-red-400">Save failed</span
				>{/if}
		</span>
	</div>
	<p class="mb-4 text-xs text-zinc-500">
		Add, remove, and reorder the fields players answer for this challenge. Toggle
		<span class="font-semibold text-amber-300">Bonus</span> for a field that adds to the team's score
		but is <em>not</em> counted toward powerup thresholds.
	</p>

	{#if fields.length === 0}
		<div
			class="mb-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-4 text-center text-xs text-zinc-500"
		>
			No fields configured — this challenge will use its variant's default fields until you add one.
		</div>
	{/if}

	<div class="space-y-2">
		{#each fields as field, idx (idx)}
			<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
				<div class="flex flex-wrap items-center gap-3">
					<!-- Reorder -->
					<div class="flex flex-col gap-0.5">
						<button
							type="button"
							onclick={() => moveField(idx, -1)}
							disabled={idx === 0}
							class="rounded px-1 text-xs text-zinc-500 hover:text-white disabled:opacity-20"
							aria-label="Move up">▲</button
						>
						<button
							type="button"
							onclick={() => moveField(idx, 1)}
							disabled={idx === fields.length - 1}
							class="rounded px-1 text-xs text-zinc-500 hover:text-white disabled:opacity-20"
							aria-label="Move down">▼</button
						>
					</div>

					<!-- Field name -->
					<select
						value={field.name}
						onchange={(e) => setName(idx, (e.target as HTMLSelectElement).value)}
						class="w-32 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
					>
						{#each availableNamesFor(idx) as n (n)}
							<option value={n}>{FIELD_LABELS[n] ?? n}</option>
						{/each}
					</select>

					<!-- Input mode — grouping is scored separately (binary fragment-set match)
					     and never reads input_mode, so there's nothing meaningful to pick. -->
					{#if field.name === 'grouping'}
						<span class="text-xs text-zinc-500">
							Binary: full points if player assigns the correct fragment set
						</span>
					{:else}
						<label class="flex items-center gap-1.5 text-xs text-zinc-400">
							Mode
							<select
								value={field.input_mode}
								onchange={(e) => setMode(idx, (e.target as HTMLSelectElement).value)}
								class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
							>
								{#each INPUT_MODES as m (m)}
									<option value={m} disabled={m === 'combobox' && !poolBackedFields.includes(field.name)}>
										{m}{m === 'combobox' && !poolBackedFields.includes(field.name) ? ' (no pool)' : ''}
									</option>
								{/each}
							</select>
						</label>
					{/if}

					<!-- Max points -->
					<label class="flex items-center gap-1.5 text-xs text-zinc-400">
						Max pts
						<input
							type="number"
							value={field.max_points}
							min="1"
							max="50"
							class="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
							onchange={(e) => setPoints(idx, parseInt((e.target as HTMLInputElement).value, 10))}
						/>
					</label>

					<!-- Bonus toggle -->
					<label
						class="flex items-center gap-1.5 text-xs text-zinc-400"
						title="Adds to score but is excluded from powerup threshold %"
					>
						<input
							type="checkbox"
							checked={field.is_bonus}
							onchange={() => toggleBonus(idx)}
							class="h-3.5 w-3.5 rounded accent-amber-400"
						/>
						Bonus
					</label>

					<button
						type="button"
						onclick={() => removeField(idx)}
						class="ml-auto text-xs text-red-700 hover:text-red-400"
					>
						✕ Remove
					</button>
				</div>

				<!-- Manage multiple-choice options -->
				{#if field.input_mode === 'multiple_choice'}
					<div class="mt-3">
						<form method="POST" action="?/saveOptions" use:enhance class="flex flex-col gap-1">
							<input type="hidden" name="field" value={field.name} />
							<textarea
								name="options"
								rows="3"
								placeholder="One option per line"
								class="input-field font-mono text-xs">{optionsFor(field.name).join('\n')}</textarea
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

	<button
		type="button"
		onclick={addField}
		disabled={!canAddField()}
		class="mt-3 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
	>
		+ Add field
	</button>
</section>
