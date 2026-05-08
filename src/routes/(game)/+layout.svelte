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
					const gs = payload.new as { play_state: string; status: string };
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
