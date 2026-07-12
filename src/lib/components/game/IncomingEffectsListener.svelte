<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';

	type EffectRow = {
		id: string;
		effect_type: string;
		payload: Record<string, unknown>;
	};

	let {
		teamId,
		setId,
		effects: initialEffects = []
	}: {
		teamId: string;
		setId: string;
		// Non-consumed team_effects for this team from the page load — used to seed
		// any give_a_shot the target hadn't acknowledged yet (e.g. hit while idle).
		effects?: EffectRow[];
	} = $props();

	type Shot = { effectId: string; sourceName: string };

	// Shots waiting to be acknowledged, oldest first. The head renders; "Drunk!"
	// consumes it server-side and shifts to the next.
	let shotQueue = $state<Shot[]>([]);
	let blockToast = $state<{ sourceName: string } | null>(null);
	let acking = $state(false);

	// Dedupe: the initial load and a realtime INSERT can both surface the same row
	// if they race. Track handled effect ids so a shot is only enqueued once.
	const seen = new Set<string>();

	function enqueueShot(row: EffectRow) {
		if (seen.has(row.id)) return;
		seen.add(row.id);
		shotQueue = [
			...shotQueue,
			{ effectId: row.id, sourceName: (row.payload.source_team_name as string) || 'Another team' }
		];
	}

	let blockTimer: ReturnType<typeof setTimeout> | undefined;
	function showBlock(row: EffectRow) {
		blockToast = { sourceName: (row.payload.source_team_name as string) || 'Another team' };
		if (blockTimer) clearTimeout(blockTimer);
		blockTimer = setTimeout(() => (blockToast = null), 6000);
	}

	async function ackShot() {
		const head = shotQueue[0];
		if (!head || acking) return;
		acking = true;
		try {
			await fetch('/api/effects/consume', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ effect_id: head.effectId })
			});
		} finally {
			acking = false;
			shotQueue = shotQueue.slice(1);
		}
	}

	onMount(() => {
		// Seed unacknowledged shots from the server-loaded effects.
		for (const e of initialEffects) {
			if (e.effect_type === 'give_a_shot') enqueueShot(e);
		}

		const channel = supabaseBrowser
			.channel(`incoming-effects-${teamId}-${setId}`)
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'team_effects',
					filter: `team_id=eq.${teamId}`
				},
				(payload) => {
					const row = payload.new as {
						id: string;
						effect_type: string;
						payload: Record<string, unknown> | null;
						set_id: string | null;
					};
					if (row.set_id && row.set_id !== setId) return;
					const eff: EffectRow = {
						id: row.id,
						effect_type: row.effect_type,
						payload: row.payload ?? {}
					};
					if (eff.effect_type === 'give_a_shot') enqueueShot(eff);
					else if (eff.effect_type === 'shield_block') showBlock(eff);
				}
			)
			.subscribe();

		return () => {
			if (blockTimer) clearTimeout(blockTimer);
			supabaseBrowser.removeChannel(channel);
		};
	});
</script>

<!-- Shield-block toast (target side: your shield saved you) -->
{#if blockToast}
	<div class="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
		<div
			class="flex items-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-950/90 px-4 py-2.5 text-sm font-semibold text-cyan-200 shadow-2xl backdrop-blur-sm"
		>
			<span class="text-lg">🛡️</span>
			<span>Your shield blocked {blockToast.sourceName}'s attack!</span>
		</div>
	</div>
{/if}

<!-- Incoming shot: acknowledgeable modal -->
{#if shotQueue.length > 0}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div
			class="w-full max-w-sm rounded-2xl border border-amber-500/60 bg-zinc-900 p-6 text-center shadow-2xl"
		>
			<div class="mb-4 flex justify-center">
				<div
					class="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-amber-400 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.3)]"
				>
					<span class="text-4xl leading-none">🥂</span>
				</div>
			</div>
			<p class="mb-1 text-xs font-bold tracking-widest text-amber-400 uppercase">You got a shot!</p>
			<p class="mb-1 text-lg font-black text-white">
				{shotQueue[0].sourceName} gave your team a shot
			</p>
			<p class="mb-6 text-sm text-zinc-400">Bottoms up — then tap below.</p>
			<button
				type="button"
				onclick={ackShot}
				disabled={acking}
				class="w-full rounded-xl bg-amber-400 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-300 disabled:opacity-50"
			>
				{acking ? '…' : '🥂 Drunk!'}
			</button>
		</div>
	</div>
{/if}
