<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mb-1 text-4xl font-black tracking-tight text-amber-400">MixUp!</div>
			<div class="text-xs uppercase tracking-widest text-zinc-400">Host Admin</div>
		</div>

		<div class="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
			<div class="text-center">
				<div class="mb-2 text-2xl font-bold text-red-400">Access denied</div>
				<p class="text-sm text-zinc-400">
					{#if data.email}
						<span class="font-mono text-zinc-300">{data.email}</span> isn't on the host whitelist.
					{:else}
						Your account isn't on the host whitelist.
					{/if}
				</p>
				<p class="mt-2 text-sm text-zinc-500">
					If you should have access, ask the project owner to add your email.
				</p>
			</div>

			<a
				href="/admin/logout"
				class="flex w-full items-center justify-center rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
			>
				Sign out
			</a>
		</div>
	</div>
</div>
