<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let avatarMenuOpen = $state(false);
	let runningLastSet = $state(false);

	function getInitial(name: string) {
		return name.charAt(0).toUpperCase();
	}
</script>

<svelte:window onclick={() => (avatarMenuOpen = false)} />

<div class="flex min-h-screen flex-col bg-zinc-950 font-[Nunito,sans-serif]">
	<!-- Top bar -->
	<header class="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
		<div class="text-sm text-zinc-500">
			<span class="text-zinc-300">{data.stats.tracks}</span> tracks ·
			<span class="text-zinc-300">{data.stats.challenges}</span> challenges ·
			<span class="text-zinc-300">{data.stats.sets}</span> sets
		</div>

		<!-- Avatar + dropdown -->
		<div class="relative">
			<button
				onclick={(e) => {
					e.stopPropagation();
					avatarMenuOpen = !avatarMenuOpen;
				}}
				class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-amber-400 text-sm font-bold text-zinc-950 ring-2 ring-transparent transition hover:ring-amber-400/50"
			>
				{#if data.user.avatarUrl}
					<img src={data.user.avatarUrl} alt={data.user.displayName} class="h-full w-full object-cover" />
				{:else}
					{getInitial(data.user.displayName)}
				{/if}
			</button>

			{#if avatarMenuOpen}
				<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
				<div
					class="absolute right-0 top-11 z-50 w-48 rounded-xl border border-zinc-800 bg-zinc-900 py-1 shadow-xl"
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => e.stopPropagation()}
				>
					<div class="border-b border-zinc-800 px-4 py-2.5">
						<div class="text-sm font-medium text-zinc-200">{data.user.displayName}</div>
						{#if data.user.email}
							<div class="truncate text-xs text-zinc-500">{data.user.email}</div>
						{/if}
					</div>
					<a
						href="/admin/settings"
						class="flex items-center gap-2 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
					>
						Settings
					</a>
					<a
						href="/admin/logout"
						class="flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-zinc-800"
					>
						Log out
					</a>
				</div>
			{/if}
		</div>
	</header>

	<main class="flex-1 p-6">
		<div class="mx-auto max-w-2xl space-y-6">
			<!-- Status panel -->
			{#if form?.error}
				<div class="rounded-xl border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
					{form.error}
				</div>
			{/if}

			{#if data.activeSet}
				<!-- Game in progress -->
				<div class="rounded-2xl border border-green-800/50 bg-green-950/30 p-6">
					<div class="mb-1 text-xs font-semibold uppercase tracking-widest text-green-400">
						Game in progress
					</div>
					<h2 class="mb-4 text-2xl font-black text-white">{data.activeSet.name}</h2>
					<div class="mb-5 flex gap-6 text-sm text-zinc-400">
						<span><span class="font-bold text-zinc-200">{data.activeSet.team_count}</span> teams</span>
						<span>
							<span class="font-bold text-zinc-200">{data.activeSet.player_count}</span> players joined
						</span>
					</div>
					<a
						href="/admin/live"
						class="inline-block rounded-lg bg-green-500 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-green-400"
					>
						Open live view →
					</a>
				</div>
			{:else}
				<!-- No game running -->
				<div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
					<div class="mb-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">
						Status
					</div>
					<h2 class="mb-4 text-2xl font-black text-zinc-400">No game running</h2>
					<div class="flex flex-wrap gap-3">
						<a
							href="/admin/sets"
							class="inline-block rounded-lg bg-amber-400 px-5 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-amber-300"
						>
							Start a set
						</a>
						{#if data.lastInactiveSet}
							<form
								method="POST"
								action="?/runLastSet"
								use:enhance={() => {
									runningLastSet = true;
									return async ({ update }) => {
										await update({ reset: false });
										runningLastSet = false;
									};
								}}
							>
								<button
									type="submit"
									disabled={runningLastSet}
									class="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white disabled:opacity-50"
								>
									{runningLastSet ? 'Starting…' : `Run "${data.lastInactiveSet.name}"`}
								</button>
							</form>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Quick action tiles -->
			<div class="grid grid-cols-3 gap-3">
				{#each [
					{ href: '/admin/sets', label: 'Sets', value: String(data.stats.sets) },
					{ href: '/admin/challenges', label: 'Challenges', value: String(data.stats.challenges) },
					{ href: '/admin/tracks', label: 'Tracks', value: String(data.stats.tracks) },
					{ href: '/admin/nfc-tags', label: 'NFC Tags', value: String(data.stats.nfcTags) },
				] as tile}
					<a
						href={tile.href}
						class="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-700 hover:bg-zinc-800/80"
					>
						<div class="text-xs font-semibold uppercase tracking-widest text-zinc-500">{tile.label}</div>
						<div class="text-2xl font-black text-white">{tile.value}</div>
					</a>
				{/each}

				<a
					href="/admin/live"
					class="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-700 hover:bg-zinc-800/80"
				>
					<div class="text-xs font-semibold uppercase tracking-widest text-zinc-500">Live</div>
					<span
						class="w-fit rounded-md px-2 py-0.5 text-xs font-semibold {data.activeSet
							? 'bg-green-500/20 text-green-400'
							: 'bg-zinc-700 text-zinc-400'}"
					>
						{data.activeSet ? 'active' : 'idle'}
					</span>
				</a>

				<a
					href="/admin/variant-defaults"
					class="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4 transition hover:border-zinc-700 hover:bg-zinc-800/80"
				>
					<div class="text-xs font-semibold uppercase tracking-widest text-zinc-500">Defaults</div>
				</a>
			</div>
		</div>
	</main>
</div>

