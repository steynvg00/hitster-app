<script lang="ts">
	import { onMount } from 'svelte';
	import { supabaseBrowser } from '$lib/supabase-browser';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	onMount(() => {
		const channel = supabaseBrowser
			.channel(`waiting-set-${data.setId}`)
			.on('postgres_changes', {
				event: 'UPDATE',
				schema: 'public',
				table: 'game_sets',
				filter: `id=eq.${data.setId}`
			}, (payload) => {
				const updated = payload.new as { status: string; recap_state: string };
				// When recap completes (host pressed End & Reset), go to thanks
				if (updated.recap_state === 'complete') {
					window.location.href = `/play/thanks?set_id=${data.setId}`;
				}
			})
			.subscribe();

		return () => supabaseBrowser.removeChannel(channel);
	});
</script>

<div class="min-h-screen flex items-center justify-center bg-zinc-950">
	<div class="text-center px-8 py-16 max-w-sm">
		<!-- Pulsing circle animation -->
		<div class="relative mx-auto mb-10 h-24 w-24">
			<div class="absolute inset-0 rounded-full bg-amber-400/20 animate-ping"></div>
			<div class="absolute inset-2 rounded-full bg-amber-400/30 animate-pulse"></div>
			<div class="absolute inset-4 flex items-center justify-center rounded-full bg-amber-400/50">
				<span class="text-2xl">🎵</span>
			</div>
		</div>

		<h1 class="mb-4 text-3xl font-black text-white">Results incoming…</h1>
		<p class="text-lg text-zinc-400 leading-relaxed">
			The host is tallying the scores.<br />
			Stand by for the big reveal!
		</p>

		<!-- Subtle live dot -->
		<div class="mt-10 flex items-center justify-center gap-2 text-xs text-zinc-600">
			<span class="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
			Waiting for host
		</div>
	</div>
</div>
