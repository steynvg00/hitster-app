<script lang="ts">
	// Artist bonus marking (C1 stuk 2) — writes points_config.artist_bonus, the
	// name-keyed { "MC Villain": 5 } map the scorer's resolveArtistBonus reads.
	//
	// Free NAME entry rather than a dropdown of a track's artists, on purpose: a
	// challenge spans tabs with DIFFERENT tracks, so there is no single artist list
	// to pick from, and a name that matches no track on a given tab simply scores
	// nothing there — that no-op IS stuk 1's model. Pool suggestions are a
	// convenience on top.
	//
	// A bonus artist is worth its points ON TOP of the artist field's max; the main
	// artists still share the field's full points between them, so marking someone
	// bonus never dilutes the rest. Missing them costs the player nothing.

	import { untrack } from 'svelte';
	import ArtistTagInput from '$lib/components/ui/ArtistTagInput.svelte';
	import HelpTooltip from '$lib/components/ui/HelpTooltip.svelte';

	let {
		artistBonus,
		artistPool
	}: {
		artistBonus: Record<string, number>;
		artistPool: string[];
	} = $props();

	// Local editable copy, debounce-saved as a whole map — same pattern as
	// FieldsEditor's fields[] and EffectsEditor's per-tab chain.
	// untrack: seed once from the server-loaded map. Without it Svelte flags the
	// prop read in a $state initializer (state_referenced_locally) — and a
	// re-seed on prop change would stomp the host's in-flight edits mid-debounce.
	let rows = $state<{ name: string; points: number }[]>(
		untrack(() => Object.entries(artistBonus).map(([name, points]) => ({ name, points })))
	);
	let saveTimer: ReturnType<typeof setTimeout>;
	let saving = $state(false);
	let lastSaveOk = $state<boolean | null>(null);

	// The add-row's name field reuses the shared tag input purely for its pool
	// suggestions, capped at one tag — the host picks/types a name, then sets points.
	let newName = $state<string[]>([]);
	let newPoints = $state(5);

	const takenNames = $derived(new Set(rows.map((r) => r.name.toLowerCase())));
	const pendingName = $derived(newName[0]?.trim() ?? '');
	const canAdd = $derived(
		pendingName.length > 0 && !takenNames.has(pendingName.toLowerCase()) && newPoints > 0
	);
	// Suggest only names not already marked — re-marking one would just overwrite.
	const availablePool = $derived(artistPool.filter((n) => !takenNames.has(n.toLowerCase())));

	function schedSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(doSave, 600);
	}

	async function doSave() {
		saving = true;
		const map: Record<string, number> = {};
		for (const r of rows) {
			const n = r.name.trim();
			if (n && r.points > 0) map[n] = r.points;
		}
		const fd = new FormData();
		fd.append('artist_bonus_json', JSON.stringify(map));
		const res = await fetch('?/saveArtistBonus', { method: 'POST', body: fd });
		saving = false;
		lastSaveOk = res.ok;
	}

	function addRow() {
		if (!canAdd) return;
		rows = [...rows, { name: pendingName, points: newPoints }];
		newName = [];
		newPoints = 5;
		schedSave();
	}

	function removeRow(idx: number) {
		rows = rows.filter((_, i) => i !== idx);
		schedSave();
	}

	function setPoints(idx: number, val: number) {
		if (!Number.isFinite(val) || val < 1) return;
		rows = rows.map((r, i) => (i === idx ? { ...r, points: val } : r));
		schedSave();
	}
</script>

<section class="mt-6">
	<div class="mb-1 flex items-center justify-between">
		<h2 class="flex items-center text-sm font-bold tracking-widest text-amber-400 uppercase">
			Bonus Artists
			<HelpTooltip
				text="Name an artist (typically an MC or vocalist) whose points are EXTRA, on top of the artist field's max. The main artists still share the field's full points between them, so marking someone bonus never lowers the rest — and a player who doesn't name them loses nothing."
			/>
		</h2>
		<span class="text-xs text-zinc-500">
			{#if saving}Saving…{:else if lastSaveOk === true}Saved{:else if lastSaveOk === false}<span
					class="text-red-400">Save failed</span
				>{/if}
		</span>
	</div>
	<p class="mb-3 text-xs text-zinc-500">
		Matched by name against each tab's track — a name that isn't on a given track simply scores
		nothing there, so one challenge can cover several tracks' MCs.
	</p>

	{#if rows.length > 0}
		<div class="mb-3 space-y-2">
			{#each rows as row, idx (row.name)}
				<div
					class="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
				>
					<span class="text-sm font-semibold text-white">{row.name}</span>
					<label class="ml-auto flex items-center gap-1.5 text-xs text-zinc-400">
						Bonus pts
						<input
							type="number"
							value={row.points}
							min="1"
							max="50"
							class="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
							onchange={(e) => setPoints(idx, parseInt((e.target as HTMLInputElement).value, 10))}
						/>
					</label>
					<button
						type="button"
						onclick={() => removeRow(idx)}
						class="text-xs text-red-700 transition-colors hover:text-red-400"
					>
						✕ Remove
					</button>
				</div>
			{/each}
		</div>
	{:else}
		<div
			class="mb-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900 p-4 text-center text-xs text-zinc-500"
		>
			No bonus artists — every artist on the track shares the field's points equally.
		</div>
	{/if}

	<!-- Add row -->
	<div class="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
		<div class="min-w-[14rem] flex-1">
			<span class="mb-1 block text-xs text-zinc-400">Artist name</span>
			<ArtistTagInput
				bind:tags={newName}
				pool={availablePool}
				maxTags={1}
				placeholder="Type a name, Enter to confirm…"
			/>
		</div>
		<label class="flex items-center gap-1.5 text-xs text-zinc-400">
			Bonus pts
			<input
				type="number"
				bind:value={newPoints}
				min="1"
				max="50"
				class="w-16 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
			/>
		</label>
		<button
			type="button"
			onclick={addRow}
			disabled={!canAdd}
			class="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-30"
		>
			+ Add bonus artist
		</button>
	</div>
</section>
