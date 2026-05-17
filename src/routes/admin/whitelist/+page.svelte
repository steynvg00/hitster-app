<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}
</script>

<div class="mx-auto max-w-3xl px-4 py-8">
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-zinc-100">Host Whitelist</h1>
		<p class="mt-1 text-sm text-zinc-400">
			Only emails on this list can access the admin panel. Super-admins can manage this list.
		</p>
	</div>

	<!-- Add email form -->
	<div class="mb-8 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
		<h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-400">Add email</h2>

		{#if form?.error}
			<div class="mb-4 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-400">
				{form.error}
			</div>
		{/if}

		<form method="POST" action="?/addEmail" use:enhance class="space-y-3">
			<div class="flex gap-3">
				<input
					type="email"
					name="email"
					required
					placeholder="host@example.com"
					class="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
				/>
				<button
					type="submit"
					class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-amber-400"
				>
					Add
				</button>
			</div>
			<div>
				<input
					type="text"
					name="notes"
					placeholder="Notes (optional)"
					class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
				/>
			</div>
			<label class="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
				<input type="checkbox" name="is_super_admin" class="rounded" />
				Grant super_admin (can manage this whitelist)
			</label>
		</form>
	</div>

	<!-- Whitelist table -->
	<div class="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
					<th class="px-4 py-3">Email</th>
					<th class="px-4 py-3">Super admin</th>
					<th class="px-4 py-3">Added</th>
					<th class="px-4 py-3">Notes</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-zinc-800">
				{#each data.entries as entry (entry.id)}
					<tr class="transition-colors hover:bg-zinc-800/40">
						<td class="px-4 py-3 font-mono text-zinc-200">{entry.email}</td>

						<!-- Toggle super_admin -->
						<td class="px-4 py-3">
							<form method="POST" action="?/toggleSuperAdmin" use:enhance>
								<input type="hidden" name="id" value={entry.id} />
								<button
									type="submit"
									title={entry.is_super_admin ? 'Revoke super_admin' : 'Grant super_admin'}
									class="rounded px-2 py-0.5 text-xs font-medium transition-colors
										{entry.is_super_admin
										? 'bg-amber-400/15 text-amber-300 hover:bg-red-900/30 hover:text-red-400'
										: 'bg-zinc-800 text-zinc-500 hover:bg-amber-400/10 hover:text-amber-400'}"
								>
									{entry.is_super_admin ? 'super_admin' : 'host'}
								</button>
							</form>
						</td>

						<td class="px-4 py-3 text-zinc-400">{formatDate(entry.added_at)}</td>
						<td class="px-4 py-3 text-zinc-500">{entry.notes ?? '—'}</td>

						<!-- Remove -->
						<td class="px-4 py-3 text-right">
							<form method="POST" action="?/removeEmail" use:enhance>
								<input type="hidden" name="id" value={entry.id} />
								<button
									type="submit"
									class="rounded px-2 py-1 text-xs text-zinc-600 transition-colors hover:bg-red-950/40 hover:text-red-400"
								>
									Remove
								</button>
							</form>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="px-4 py-8 text-center text-sm text-zinc-600">
							No entries yet. Add an email above.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if form?.error}
		<div class="mt-4 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}
</div>
