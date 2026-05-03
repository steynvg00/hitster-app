<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const PURPOSE_LABEL: Record<string, string> = {
		randomizer: 'Randomizer',
		challenge: 'Challenge',
		team_identity: 'Team identity',
		team_entry: 'Team entry'
	};

	function boundResource(tag: (typeof data.tags)[0]): { label: string; href: string | null } {
		if (tag.purpose === 'randomizer') {
			if (tag.set_id)
				return { label: tag.set_name ?? tag.set_id, href: `/admin/sets/${tag.set_id}` };
			return { label: '(orphan — no set)', href: null };
		}
		if (tag.purpose === 'challenge') {
			if (tag.challenge_id)
				return {
					label: tag.challenge_title ?? tag.challenge_id,
					href: `/admin/challenges/${tag.challenge_id}`
				};
			return { label: '(orphan — no challenge)', href: null };
		}
		if (tag.purpose === 'team_identity' || tag.purpose === 'team_entry') {
			return { label: `Team: ${tag.team_color ?? '?'}`, href: '/admin/teams' };
		}
		return { label: '—', href: null };
	}
</script>

<svelte:head>
	<title>NFC Tags — Admin</title>
</svelte:head>

<div class="p-8">
	<div class="mb-6">
		<h1 class="text-2xl font-black text-white">NFC Tags</h1>
		<p class="mt-0.5 text-sm text-zinc-400">
			All tags in the system — {data.tags.length} total.
		</p>
	</div>

	{#if data.tags.length === 0}
		<p class="text-sm text-zinc-600">No tags registered yet.</p>
	{:else}
		<div class="overflow-hidden rounded-xl border border-zinc-800">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-zinc-800 text-left text-xs uppercase tracking-widest text-zinc-500">
						<th class="px-4 py-3">Slug / ID</th>
						<th class="px-4 py-3">Type</th>
						<th class="px-4 py-3">Bound to</th>
						<th class="px-4 py-3 text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.tags as tag (tag.id)}
						{@const res = boundResource(tag)}
						<tr class="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/50">
							<td class="px-4 py-3 font-mono text-zinc-300">{tag.id}</td>
							<td class="px-4 py-3">
								<span
									class="rounded-full px-2 py-0.5 text-xs font-semibold
									{tag.purpose === 'randomizer'
										? 'bg-amber-900/40 text-amber-400'
										: tag.purpose === 'challenge'
											? 'bg-blue-900/40 text-blue-400'
											: 'bg-zinc-700 text-zinc-300'}"
								>
									{PURPOSE_LABEL[tag.purpose] ?? tag.purpose}
								</span>
							</td>
							<td class="px-4 py-3">
								{#if res.href}
									<a href={res.href} class="text-zinc-300 underline underline-offset-2 hover:text-white">
										{res.label}
									</a>
								{:else}
									<span class="text-zinc-600">{res.label}</span>
								{/if}
							</td>
							<td class="px-4 py-3 text-right">
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={tag.id} />
									<button
										type="submit"
										onclick={(e) => {
											if (!confirm(`Delete tag "${tag.id}"? This cannot be undone.`))
												e.preventDefault();
										}}
										class="rounded px-2 py-1 text-xs text-red-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
									>
										Delete
									</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
