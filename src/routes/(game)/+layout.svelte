<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	onMount(() => {
		if (!data.activeSetId) return;

		const channel = supabaseBrowser
			.channel(`game-end-watch-${data.activeSetId}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'game_sets',
					filter: `id=eq.${data.activeSetId}`
				},
				(payload) => {
					const gs = payload.new as {
						play_state: string;
						status: string;
						player_epoch?: string | null;
					};

					// ── De host heeft gereset ────────────────────────────────────
					// player_epoch schuift ALLEEN op in resetGameState()
					// ($lib/server/reset.ts) — niet bij wegnavigeren, niet bij het
					// sluiten van de tab, niet bij het verlaten van de app. Het is
					// dus precies het signaal "deze ronde is opnieuw begonnen".
					//
					// Waarom een volledige herlaadslag en geen goto(): de reset kan
					// de cookies op deze telefoon niet wissen. Dat gebeurt pas bij
					// het eerstvolgende ECHTE verzoek, in hooks.server.ts, dat de
					// cookie van vóór de epoch ongeldig verklaart en de speler naar
					// /join stuurt. Een client-side navigatie zonder herlaadslag zou
					// die stap kunnen overslaan en de speler op een spookscherm
					// laten staan — met de oude set in beeld en niets erachter.
					if (data.playerEpoch && gs.player_epoch && gs.player_epoch !== data.playerEpoch) {
						window.location.reload();
						return;
					}

					if (gs.play_state === 'recap' || gs.status === 'inactive') {
						goto('/play/thanks');
					}
				}
			)
			.subscribe();

		return () => supabaseBrowser.removeChannel(channel);
	});
</script>

{@render children()}
