<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const VARIANTS = ['normal','label','anthem','vocal','fragments','kick','mashup','battle'] as const;

	const DEFAULT_POINTS: Record<string, object> = {
		normal:    { artist: 5, title: 5, year: { exact: 10, off1: 5, off2: 2 } },
		label:     { label: 10 },
		anthem:    { festival: 5, artist: 5, title: 5, year: { exact: 10, off1: 5, off2: 2 } },
		vocal:     { vocal_source: 15 },
		fragments: { correct_order: 20 },
		kick:      { per_correct: 5 },
		mashup:    { per_correct: 5 },
		battle:    { winner: 20, closest: 10 }
	};

	let showCreate = $state(false);
	let newVariant = $state('normal');
	let pointsJson = $state(JSON.stringify(DEFAULT_POINTS['normal'], null, 2));

	$effect(() => {
		pointsJson = JSON.stringify(DEFAULT_POINTS[newVariant] ?? {}, null, 2);
	});

	const statusColor: Record<string, string> = {
		draft: 'text-zinc-400 bg-zinc-800',
		active: 'text-green-400 bg-green-900/40',
		completed: 'text-blue-400 bg-blue-900/40'
	};

	$effect(() => {
		if (form?.success) showCreate = false;
	});
</script>

<div class="p-6">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white">Challenges</h1>
			<p class="text-zinc-400 text-sm mt-0.5">{data.challenges.length} challenges</p>
		</div>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold px-4 py-2 rounded-lg text-sm transition-colors"
		>
			+ New Challenge
		</button>
	</div>

	{#if form?.error}
		<div class="bg-red-950 border border-red-800 text-red-300 text-sm rounded-lg px-4 py-3 mb-4">{form.error}</div>
	{/if}

	<!-- Create form -->
	{#if showCreate}
		<div class="bg-zinc-900 border border-amber-400/30 rounded-xl p-5 mb-6">
			<h2 class="text-sm font-semibold text-amber-400 uppercase tracking-widest mb-4">New Challenge</h2>
			<form method="POST" action="?/create" use:enhance class="space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<input name="title" placeholder="Challenge name *" required class="input-field" />
					<input name="stage_label" placeholder="Stage label (e.g. Blue: Raw)" class="input-field" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-xs text-zinc-400 mb-1">Variant *</label>
						<select name="variant" bind:value={newVariant} required class="input-field">
							{#each VARIANTS as v}
								<option value={v}>{v}</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="block text-xs text-zinc-400 mb-1">Timer (seconds)</label>
						<input name="timer_seconds" type="number" value="60" min="10" max="600" class="input-field" />
					</div>
				</div>
				<div>
					<label class="block text-xs text-zinc-400 mb-1">Points config (JSON)</label>
					<textarea name="points_config" bind:value={pointsJson} rows="4" class="input-field font-mono text-xs"></textarea>
				</div>
				<div class="flex gap-2 justify-end">
					<button type="button" onclick={() => (showCreate = false)} class="btn-ghost">Cancel</button>
					<button type="submit" class="btn-primary">Create & Edit</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Challenge list -->
	<div class="space-y-2">
		{#each data.challenges as challenge (challenge.id)}
			<div class="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-4 hover:border-zinc-700 transition-colors">
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2">
						<span class="font-medium text-white">{challenge.title}</span>
						<span class="text-xs font-mono text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">{challenge.variant}</span>
						<span class="text-xs px-2 py-0.5 rounded font-medium {statusColor[challenge.status] ?? 'text-zinc-400'}">
							{challenge.status}
						</span>
					</div>
					<div class="flex items-center gap-3 mt-0.5 text-xs text-zinc-500">
						{#if challenge.stage_label}
							<span>{challenge.stage_label}</span>
							<span>·</span>
						{/if}
						<span>{challenge.trackCount} track{challenge.trackCount !== 1 ? 's' : ''}</span>
						<span>·</span>
						<span>{challenge.submissionCount} submission{challenge.submissionCount !== 1 ? 's' : ''}</span>
						<span>·</span>
						<span>{challenge.timer_seconds}s timer</span>
					</div>
				</div>

				<a
					href="/admin/challenges/{challenge.id}"
					class="text-amber-400 hover:text-amber-300 text-sm font-medium shrink-0 transition-colors"
				>
					Edit →
				</a>

				<form method="POST" action="?/delete" use:enhance>
					<input type="hidden" name="id" value={challenge.id} />
					<button
						type="submit"
						onclick={(e) => { if (!confirm(`Delete "${challenge.title}"?`)) e.preventDefault(); }}
						class="text-red-700 hover:text-red-400 text-sm px-2 py-1 rounded hover:bg-zinc-800 transition-colors"
					>
						✕
					</button>
				</form>
			</div>
		{/each}

		{#if data.challenges.length === 0}
			<div class="text-center py-16 text-zinc-600">
				<div class="text-4xl mb-3">🎯</div>
				<p>No challenges yet. Create one above.</p>
			</div>
		{/if}
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
	:global(.input-field:focus) { outline: none; border-color: #fbbf24; }
	:global(.btn-primary) {
		background: #fbbf24; color: #09090b; font-weight: 700;
		padding: 0.4rem 1rem; border-radius: 0.5rem; font-size: 0.875rem;
		transition: background 0.15s;
	}
	:global(.btn-primary:hover) { background: #fcd34d; }
	:global(.btn-ghost) {
		background: transparent; border: 1px solid #3f3f46; color: #a1a1aa;
		font-weight: 500; padding: 0.4rem 1rem; border-radius: 0.5rem;
		font-size: 0.875rem; transition: all 0.15s;
	}
	:global(.btn-ghost:hover) { border-color: #71717a; color: #f4f4f5; }
</style>
