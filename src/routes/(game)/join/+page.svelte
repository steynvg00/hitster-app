<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Explicit hex values — avoids Tailwind purging dynamic class names
	const teamColors: Record<string, { bg: string; text: string }> = {
		blue: { bg: '#3b82f6', text: '#fff' },
		yellow: { bg: '#eab308', text: '#000' },
		green: { bg: '#22c55e', text: '#000' },
		red: { bg: '#ef4444', text: '#fff' },
		indigo: { bg: '#6366f1', text: '#fff' },
		black: { bg: '#1e293b', text: '#fff' }
	};
</script>

<div class="mx-auto min-h-screen max-w-lg p-6">
	<div class="mb-8 pt-4">
		<h1 class="text-3xl font-black">Pick your team</h1>
		<p class="mt-2 text-sm text-zinc-400">
			Tap your team's NFC card to skip this screen in future.
		</p>
	</div>

	{#if data.error === 'unknown-tag'}
		<div class="mb-6 rounded-xl border border-yellow-600/50 bg-yellow-900/20 p-3 text-sm text-yellow-300">
			Unrecognised NFC tag — pick your team manually below.
		</div>
	{/if}

	<form method="POST" use:enhance class="grid grid-cols-2 gap-3">
		<input type="hidden" name="redirect" value={data.redirectTo} />

		{#each data.teams as team}
			{@const c = teamColors[team.color] ?? { bg: '#6b7280', text: '#fff' }}
			<button
				type="submit"
				name="team_id"
				value={team.id}
				class="rounded-2xl py-6 text-center font-black uppercase tracking-wide transition-opacity hover:opacity-90 active:scale-95"
				style="background-color: {c.bg}; color: {c.text};"
			>
				{team.label}
			</button>
		{/each}
	</form>
</div>
