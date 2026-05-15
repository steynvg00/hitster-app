<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';

	type PowerupType = {
		id: string;
		name: string;
		icon: string | null;
		description: string | null;
		holdable: boolean;
		immediate_use: boolean;
	};

	type HeldPowerup = {
		id: string;
		powerup_type_id: string;
		granted_at: string;
		type: PowerupType;
	};

	let {
		teamId,
		setId,
		powerups: initialPowerups
	}: {
		teamId: string;
		setId: string;
		powerups: HeldPowerup[];
	} = $props();

	let powerups = $state<HeldPowerup[]>(initialPowerups);
	let toastVisible = $state(false);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function showToast() {
		toastVisible = true;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastVisible = false), 2500);
	}

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`held-powerups-${teamId}-${setId}`)
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'team_powerups',
					filter: `team_id=eq.${teamId}`
				},
				async () => {
					// Re-fetch held powerups on any change for this team
					const { data } = await supabaseBrowser
						.from('team_powerups')
						.select('id, powerup_type_id, granted_at, powerup_types(id, name, icon, description, holdable, immediate_use)')
						.eq('team_id', teamId)
						.eq('set_id', setId)
						.eq('status', 'held')
						.order('granted_at');
					powerups = (data ?? []).map((r) => ({
						id: r.id,
						powerup_type_id: r.powerup_type_id,
						granted_at: r.granted_at ?? '',
						type: (r as unknown as { powerup_types: PowerupType }).powerup_types
					}));
				}
			)
			.subscribe();
		return () => supabaseBrowser.removeChannel(channel);
	});
</script>

{#if powerups.length > 0 || true}
	<div class="flex items-center gap-2 py-1">
		<span class="shrink-0 text-xs font-semibold text-zinc-500 uppercase tracking-widest">Held</span>
		{#if powerups.length === 0}
			<span class="text-xs text-zinc-600 italic">No powerups held</span>
		{:else}
			<div class="flex flex-wrap gap-1.5">
				{#each powerups as p (p.id)}
					<button
						type="button"
						onclick={showToast}
						class="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-200 transition-colors hover:border-zinc-500"
						title={p.type?.description ?? ''}
					>
						{#if p.type?.icon}
							<span>{p.type.icon}</span>
						{/if}
						<span>{p.type?.name ?? p.powerup_type_id}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

{#if toastVisible}
	<div
		class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-300 shadow-xl"
	>
		Activation coming soon ✦
	</div>
{/if}
