<script lang="ts">
	type BattleConfig = { enabled: boolean };

	let { battleConfig }: { battleConfig: BattleConfig } = $props();

	// Local editable copy — same debounced auto-persist pattern as FieldsEditor.
	// Er valt hier maar één ding te zetten: aan of uit. Een battle deelt geen
	// punten uit, dus er is ook geen maximum meer om in te stellen.
	let enabled = $state(battleConfig.enabled);
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
		fd.append('enabled', enabled ? 'true' : 'false');
		const res = await fetch('?/saveBattle', { method: 'POST', body: fd });
		saving = false;
		lastSaveOk = res.ok;
	}

	function toggleEnabled() {
		enabled = !enabled;
		schedSave();
	}
</script>

<div>
	<div class="mb-1 flex items-center justify-between">
		<label class="flex items-center gap-2 text-xs text-zinc-400">
			<input
				type="checkbox"
				checked={enabled}
				onchange={toggleEnabled}
				class="h-4 w-4 rounded accent-amber-400"
			/>
			Battle mode
		</label>
		<span class="text-xs text-zinc-500">
			{#if saving}Saving…{:else if lastSaveOk === true}Saved{:else if lastSaveOk === false}<span
					class="text-red-400">Save failed</span
				>{/if}
		</span>
	</div>
	<p class="mb-2 text-[11px] text-zinc-600">
		All teams play this challenge normally — full score, multipliers, and powerups apply as usual.
		Once every team finishes, the recap shows a ranking of what each team scored on this challenge;
		highest wins the battle. No bonus points are awarded — the battle is display only.
	</p>
</div>
