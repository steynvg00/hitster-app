<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import PowerupActivationModal from './PowerupActivationModal.svelte';

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

	type TargetTeam = {
		id: string;
		color: string;
		display_name: string;
		hasActiveTimedAttempt?: boolean;
	};

	let {
		teamId,
		setId,
		powerups: initialPowerups,
		currentChallengeId,
		variantFields = [],
		setTeams = [],
		onactivated
	}: {
		teamId: string;
		setId: string;
		powerups: HeldPowerup[];
		currentChallengeId?: string;
		variantFields?: string[];
		setTeams?: TargetTeam[];
		onactivated?: (revealedValue?: string, revealedField?: string) => void;
	} = $props();

	// The teams a caster can attack — every team in the set except their own.
	const targetTeams = $derived(setTeams.filter((t) => t.id !== teamId));

	let powerups = $state<HeldPowerup[]>(initialPowerups);
	let selectedPowerup = $state<HeldPowerup | null>(null);

	function openModal(p: HeldPowerup) {
		selectedPowerup = p;
	}

	function onModalClose(activated?: boolean, revealedValue?: string, revealedField?: string) {
		selectedPowerup = null;
		if (activated && (revealedValue || revealedField)) {
			onactivated?.(revealedValue, revealedField);
		}
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
					const { data } = await supabaseBrowser
						.from('team_powerups')
						.select(
							'id, powerup_type_id, granted_at, powerup_types(id, name, icon, description, holdable, immediate_use)'
						)
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
		<span class="shrink-0 text-xs font-semibold tracking-widest text-zinc-500 uppercase">Held</span>
		{#if powerups.length === 0}
			<span class="text-xs text-zinc-600 italic">No powerups held</span>
		{:else}
			<div class="flex flex-wrap gap-1.5">
				{#each powerups as p (p.id)}
					<button
						type="button"
						onclick={() => openModal(p)}
						class="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-200 transition-colors hover:border-amber-600/60 hover:bg-amber-500/10 hover:text-amber-300"
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

{#if selectedPowerup}
	<PowerupActivationModal
		teamPowerupId={selectedPowerup.id}
		type={selectedPowerup.type}
		onclose={onModalClose}
		{currentChallengeId}
		{variantFields}
		{targetTeams}
	/>
{/if}
