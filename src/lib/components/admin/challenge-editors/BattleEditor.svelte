<script lang="ts">
	type BattleConfig = { enabled: boolean; max_points: number };

	let { battleConfig }: { battleConfig: BattleConfig } = $props();

	// Local editable copy — same debounced auto-persist pattern as FieldsEditor.
	// De ladder zelf wordt hier niet bewerkt: die volgt bij resolutie uit deze
	// ene maxwaarde + het échte team_count van de set (lineair max→0 in gelijke
	// stappen), dus de editor heeft aan één getal genoeg.
	let enabled = $state(battleConfig.enabled);
	let maxPoints = $state(battleConfig.max_points);
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
		fd.append('max_points', String(maxPoints));
		const res = await fetch('?/saveBattle', { method: 'POST', body: fd });
		saving = false;
		lastSaveOk = res.ok;
	}

	function toggleEnabled() {
		enabled = !enabled;
		schedSave();
	}

	function setMaxPoints(val: number) {
		if (!Number.isFinite(val) || val < 0) return;
		maxPoints = Math.round(val);
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
		Once every team finishes, they're ranked by what they scored on this challenge and each gets a
		bonus on top: the max for rank 1, split linearly down to 0 by rank across the set's team count
		(last place gets nothing). Tied teams share a rank and both get that rank's bonus.
	</p>
	{#if enabled}
		<div class="flex items-center gap-2">
			<label class="text-xs text-zinc-400" for="battle-max-points">Max points (rank 1)</label>
			<input
				id="battle-max-points"
				type="number"
				value={maxPoints}
				min="0"
				class="input-field w-24"
				onchange={(e) => setMaxPoints(parseInt((e.target as HTMLInputElement).value, 10))}
			/>
		</div>
	{/if}
</div>
