<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { pushToast } from '$lib/stores/toasts.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type TeamRow = (typeof data.teams)[number];

	const teamColorHex: Record<string, string> = {
		blue: '#3b82f6',
		yellow: '#eab308',
		green: '#22c55e',
		red: '#ef4444',
		indigo: '#6366f1',
		black: '#64748b'
	};

	let adjustingTeam = $state<string | null>(null);
	let adjustDelta = $state(0);
	let adjustReason = $state('');
	let confirmReset = $state(false);
	let editingNameTeam = $state<string | null>(null);
	let editingNameValue = $state('');
	let uploadingTeam = $state<string | null>(null);

	$effect(() => {
		if (form?.success) {
			adjustingTeam = null;
			adjustDelta = 0;
			adjustReason = '';
			confirmReset = false;
			editingNameTeam = null;
			editingNameValue = '';
			uploadingTeam = null;
		}
	});

	function startAdjust(team: TeamRow) {
		adjustingTeam = team.id;
		adjustDelta = 0;
		adjustReason = '';
	}

	function startEditName(team: TeamRow) {
		editingNameTeam = team.id;
		editingNameValue = team.display_name;
	}
</script>

<div class="p-6">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold text-white">Teams</h1>
			<p class="mt-0.5 text-sm text-zinc-400">Score management and game reset</p>
		</div>
		{#if !confirmReset}
			<button
				onclick={() => (confirmReset = true)}
				class="rounded-lg border border-red-800 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-950"
			>
				⚠ Reset Everything
			</button>
		{:else}
			<div class="flex items-center gap-2 rounded-xl border border-red-700 bg-red-950 p-3">
				<span class="text-sm text-red-300"
					>Clear all scores, submissions, attempts, review requests, and activity log? Challenges
					revert to active.</span
				>
				<form method="POST" action="?/resetEverything" use:enhance class="flex gap-2">
					<button
						type="submit"
						class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-red-500"
					>
						Yes, reset all
					</button>
				</form>
				<button
					onclick={() => (confirmReset = false)}
					class="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
				>
					Cancel
				</button>
			</div>
		{/if}
	</div>

	{#if form?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			{form.error}
		</div>
	{/if}
	{#if form?.success && form?.action === 'resetEverything'}
		<div
			class="mb-4 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300"
		>
			Everything reset.
		</div>
	{/if}

	<div class="space-y-3">
		{#each data.teams as team (team.id)}
			<div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
				<div class="flex items-center gap-4">
					<!-- Team avatar (photo or color swatch) -->
					<div class="relative shrink-0">
						{#if (team as unknown as { photo_url?: string | null }).photo_url}
							<img
								src={(team as unknown as { photo_url?: string | null }).photo_url!}
								alt={team.display_name}
								class="h-10 w-10 rounded-full border-2 object-cover"
								style="border-color: {teamColorHex[team.color] ?? '#666'};"
							/>
						{:else}
							<div
								class="flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold text-white"
								style="background-color: {teamColorHex[team.color] ??
									'#666'}33; border-color: {teamColorHex[team.color] ?? '#666'}66;"
							>
								{team.display_name[0]?.toUpperCase() ?? '?'}
							</div>
						{/if}
					</div>

					<div class="flex-1">
						{#if editingNameTeam === team.id}
							<form
								method="POST"
								action="?/updateDisplayName"
								use:enhance
								class="flex items-center gap-2"
							>
								<input type="hidden" name="team_id" value={team.id} />
								<input
									name="display_name"
									bind:value={editingNameValue}
									required
									class="input-field min-w-0 flex-1 py-1 text-sm"
								/>
								<button type="submit" class="btn-primary text-xs">Save</button>
								<button
									type="button"
									onclick={() => (editingNameTeam = null)}
									class="btn-ghost text-xs">Cancel</button
								>
							</form>
						{:else}
							<div class="font-semibold text-white">{team.display_name}</div>
							<div class="mt-0.5 text-xs text-zinc-500">
								{team.submissionCount} submission{team.submissionCount !== 1 ? 's' : ''}
							</div>
						{/if}
					</div>

					<div class="text-3xl font-black text-white tabular-nums">{team.score}</div>

					<div class="flex flex-wrap gap-2">
						<button
							onclick={() => startEditName(team)}
							class="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-400"
						>
							Name
						</button>
						<button
							onclick={() => (uploadingTeam = uploadingTeam === team.id ? null : team.id)}
							class="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-amber-400 hover:text-amber-400"
						>
							Photo
						</button>
						<button
							onclick={() => startAdjust(team)}
							class="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-amber-400 hover:text-amber-400"
						>
							Adjust
						</button>

						<form method="POST" action="?/resetScore" use:enhance>
							<input type="hidden" name="team_id" value={team.id} />
							<button
								type="submit"
								onclick={(e) => {
									if (!confirm(`Reset ${team.display_name} score to 0?`)) e.preventDefault();
								}}
								class="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:border-red-700 hover:text-red-400"
							>
								Reset
							</button>
						</form>
					</div>
				</div>

				<!-- Photo upload panel -->
				{#if uploadingTeam === team.id}
					<div class="mt-3 border-t border-zinc-800 pt-3">
						<form
							method="POST"
							action="?/uploadPhoto"
							enctype="multipart/form-data"
							use:enhance={() =>
								async ({ update }) => {
									uploadingTeam = null;
									await update();
								}}
						>
							<input type="hidden" name="team_id" value={team.id} />
							<div class="flex flex-wrap items-center gap-2">
								<input
									name="photo"
									type="file"
									accept="image/*"
									required
									class="min-w-0 flex-1 text-sm text-zinc-300 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200"
								/>
								<button type="submit" class="btn-primary text-xs whitespace-nowrap">Upload</button>
								<button
									type="button"
									onclick={() => (uploadingTeam = null)}
									class="btn-ghost text-xs">Cancel</button
								>
							</div>
							<p class="mt-1 text-xs text-zinc-600">
								Max 2 MB, any image format. Stored in team-photos bucket.
							</p>
						</form>
					</div>
				{/if}

				<!-- Adjust score panel -->
				{#if adjustingTeam === team.id}
					<div class="mt-4 border-t border-zinc-800 pt-4">
						<form
							method="POST"
							action="?/adjustScore"
							use:enhance={({ cancel: _cancel }) =>
								async ({ result, update }) => {
									await update({ reset: false });
									if (result.type === 'success') {
										const data = result.data as { success?: boolean; message?: string } | undefined;
										if (data?.success && data.message) {
											pushToast(data.message, 'success');
										}
										adjustingTeam = null;
										adjustDelta = 0;
										adjustReason = '';
									}
								}}
							class="flex flex-wrap items-end gap-2"
						>
							<input type="hidden" name="team_id" value={team.id} />
							<div>
								<label class="mb-1 block text-xs text-zinc-400">Points (+ or −)</label>
								<input
									name="delta"
									type="number"
									bind:value={adjustDelta}
									class="input-field w-28 text-center text-lg font-bold"
									placeholder="±pts"
								/>
							</div>
							<div class="min-w-48 flex-1">
								<label class="mb-1 block text-xs text-zinc-400">Reason (required)</label>
								<input
									name="reason"
									bind:value={adjustReason}
									required
									class="input-field"
									placeholder="e.g. bonus round, tiebreak..."
								/>
							</div>
							<button type="submit" class="btn-primary" disabled={!adjustReason}>Apply</button>
							<button type="button" onclick={() => (adjustingTeam = null)} class="btn-ghost"
								>Cancel</button
							>
						</form>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	:global(.input-field) {
		background: #27272a;
		border: 1px solid #3f3f46;
		border-radius: 0.5rem;
		padding: 0.5rem 0.75rem;
		color: #f4f4f5;
		font-size: 0.875rem;
		width: 100%;
		transition: border-color 0.15s;
	}
	:global(.input-field:focus) {
		outline: none;
		border-color: #fbbf24;
	}
	:global(.btn-primary) {
		background: #fbbf24;
		color: #09090b;
		font-weight: 700;
		padding: 0.4rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		transition: background 0.15s;
	}
	:global(.btn-primary:hover) {
		background: #fcd34d;
	}
	:global(.btn-primary:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
	}
	:global(.btn-ghost) {
		background: transparent;
		border: 1px solid #3f3f46;
		color: #a1a1aa;
		font-weight: 500;
		padding: 0.4rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		transition: all 0.15s;
	}
	:global(.btn-ghost:hover) {
		border-color: #71717a;
		color: #f4f4f5;
	}
</style>
