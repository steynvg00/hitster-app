<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const TEAM_STYLE: Record<string, { swatch: string; text: string; border: string; bg: string }> = {
		blue: {
			swatch: 'bg-blue-500',
			text: 'text-blue-300',
			border: 'border-blue-700/60',
			bg: 'bg-blue-950/30 hover:bg-blue-950/50'
		},
		yellow: {
			swatch: 'bg-yellow-400',
			text: 'text-yellow-300',
			border: 'border-yellow-700/60',
			bg: 'bg-yellow-950/30 hover:bg-yellow-950/50'
		},
		green: {
			swatch: 'bg-green-500',
			text: 'text-green-300',
			border: 'border-green-700/60',
			bg: 'bg-green-950/30 hover:bg-green-950/50'
		},
		red: {
			swatch: 'bg-red-500',
			text: 'text-red-300',
			border: 'border-red-700/60',
			bg: 'bg-red-950/30 hover:bg-red-950/50'
		},
		indigo: {
			swatch: 'bg-indigo-500',
			text: 'text-indigo-300',
			border: 'border-indigo-700/60',
			bg: 'bg-indigo-950/30 hover:bg-indigo-950/50'
		},
		black: {
			swatch: 'bg-zinc-600',
			text: 'text-zinc-300',
			border: 'border-zinc-600/60',
			bg: 'bg-zinc-800/40 hover:bg-zinc-800/60'
		}
	};

	let joining = $state<string | null>(null);
</script>

<svelte:head>
	<title>Join {data.setName} — Hitster</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-zinc-950 px-5 py-10">
	<div class="mx-auto w-full max-w-sm">
		<div class="mb-8 text-center">
			<h1 class="text-2xl font-black text-white">Pick your team</h1>
			<p class="mt-1 text-sm text-zinc-400">{data.setName}</p>
		</div>

		{#if form?.error}
			<div
				class="mb-5 rounded-lg border border-red-800 bg-red-950/60 px-4 py-3 text-sm text-red-300"
			>
				{form.error}
			</div>
		{/if}

		<div class="space-y-3">
			{#each data.teamList as team}
				{@const style = TEAM_STYLE[team.color] ?? TEAM_STYLE.black}
				<form
					method="POST"
					action="?/joinTeam"
					use:enhance={() => {
						joining = team.id;
						return async ({ update }) => {
							joining = null;
							await update();
						};
					}}
				>
					<input type="hidden" name="team_id" value={team.id} />
					<button
						type="submit"
						disabled={joining !== null || team.is_full}
						class="w-full rounded-2xl border p-4 text-left transition-all active:scale-[0.98]
							disabled:opacity-60
							{team.is_full
							? 'cursor-not-allowed border-zinc-800 bg-zinc-900/50 opacity-50'
							: `${style.bg} ${style.border}`}"
					>
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<div class="h-3 w-3 shrink-0 rounded-full {style.swatch}"></div>
								<span class="font-bold {style.text}">{team.display_name}</span>
							</div>
							<span class="text-xs text-zinc-500">
								{#if team.is_full}
									<span class="font-semibold text-zinc-600">Full</span>
								{:else if data.slotsPerTeam !== null}
									{team.member_count}/{data.slotsPerTeam}
								{:else}
									{team.member_count} joined
								{/if}
							</span>
						</div>
						{#if joining === team.id}
							<div class="mt-2 text-center text-xs font-semibold text-amber-400">Joining…</div>
						{/if}
					</button>
				</form>
			{/each}
		</div>
	</div>
</div>
