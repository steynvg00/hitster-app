<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const f = $derived(form as any);

	const teamColors: Record<string, string> = {
		blue: '#3b82f6', yellow: '#eab308', green: '#22c55e',
		red: '#ef4444', indigo: '#6366f1', black: '#1e293b'
	};

	// Realtime: reload page when review_requests change
	onMount(() => {
		const channel = supabaseBrowser
			.channel('review-queue')
			.on('postgres_changes', { event: '*', schema: 'public', table: 'review_requests' }, () => {
				window.location.reload();
			})
			.subscribe();

		return () => { supabaseBrowser.removeChannel(channel); };
	});

	// Per-request award points (host can adjust before approving)
	type RequestRow = (typeof data.requests)[number];
	let awardPoints = $state<Record<string, number>>({});

	function initAward(rr: RequestRow) {
		if (awardPoints[rr.id] === undefined) awardPoints[rr.id] = 5;
	}
</script>

<div class="p-6 max-w-3xl">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-white">Review Queue</h1>
		<p class="mt-0.5 text-sm text-zinc-400">
			{data.requests.length} pending
			{data.requests.length === 1 ? 'request' : 'requests'} — approve or reject each one
		</p>
	</div>

	{#if f?.error}
		<div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
			{f.error}
		</div>
	{/if}

	{#if data.loadError}
		<p class="text-sm text-red-400">Failed to load: {data.loadError}</p>
	{:else if data.requests.length === 0}
		<div class="rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-12 text-center">
			<div class="mb-2 text-3xl">✓</div>
			<div class="text-zinc-400">No pending review requests</div>
		</div>
	{:else}
		<div class="space-y-4">
			{#each data.requests as rr (rr.id)}
				{@const hex = teamColors[rr.teamColor] ?? '#71717a'}
				{() => initAward(rr)}

				<div class="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
					<!-- Header -->
					<div class="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
						<div class="flex items-center gap-2">
							<span
								class="rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white"
								style="background-color: {hex};"
							>
								{rr.teamName}
							</span>
							<span class="text-sm text-zinc-400">{rr.challengeTitle}</span>
						</div>
						<span class="font-mono text-xs text-zinc-600">
							{new Date(rr.created_at).toLocaleTimeString()}
						</span>
					</div>

					<!-- Body -->
					<div class="px-5 py-4">
						<div class="mb-4 grid grid-cols-3 gap-4 text-sm">
							<div>
								<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Field</div>
								<div class="font-medium text-white capitalize">{rr.field_name.replace('_', ' ')}</div>
							</div>
							<div>
								<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">They answered</div>
								<div class="font-medium text-white">{rr.submitted}</div>
							</div>
							<div>
								<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Current score</div>
								<div class="font-medium text-white">{rr.currentScore} pts</div>
							</div>
						</div>

						{#if rr.player_message}
							<div class="mb-4 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-2">
								<div class="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Message</div>
								<p class="text-sm text-zinc-300 italic">"{rr.player_message}"</p>
							</div>
						{/if}

						<!-- Actions -->
						<div class="flex items-center gap-3">
							<!-- Approve (with point award) -->
							<form method="POST" action="?/approve" use:enhance class="flex items-center gap-2">
								<input type="hidden" name="request_id" value={rr.id} />
								<input type="hidden" name="submission_id" value={rr.submission_id} />
								<input type="hidden" name="field_name" value={rr.field_name} />
								<div class="flex items-center gap-1">
									<label class="text-xs text-zinc-500">+</label>
									<input
										type="number"
										name="award_points"
										bind:value={awardPoints[rr.id]}
										min="0"
										max="20"
										class="w-16 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-center text-sm text-white focus:outline-none"
									/>
									<label class="text-xs text-zinc-500">pts</label>
								</div>
								<button
									type="submit"
									class="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-bold text-white transition-colors hover:bg-green-500"
								>
									Approve
								</button>
							</form>

							<!-- Reject -->
							<form method="POST" action="?/reject" use:enhance>
								<input type="hidden" name="request_id" value={rr.id} />
								<input type="hidden" name="submission_id" value={rr.submission_id} />
								<button
									type="submit"
									class="rounded-lg border border-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:border-red-600 hover:text-red-400"
								>
									Reject
								</button>
							</form>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
