<script lang="ts">
	import { enhance } from '$app/forms';
	import HostAuthForm from '$lib/components/HostAuthForm.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let testLoading = $state(false);
</script>

<div class="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mb-1 text-4xl font-black tracking-tight text-amber-400">MixUp!</div>
			<div class="text-xs uppercase tracking-widest text-zinc-400">Host Admin</div>
		</div>

		<div class="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
			<HostAuthForm {form} />

			{#if import.meta.env.DEV}
				<div class="border-t border-zinc-800 pt-3">
					<form
						method="POST"
						action="?/testLogin"
						use:enhance={() => {
							testLoading = true;
							return async ({ update }) => {
								await update();
								testLoading = false;
							};
						}}
					>
						<button
							type="submit"
							disabled={testLoading}
							class="w-full rounded-lg border border-orange-900/60 bg-orange-950/40 px-4 py-2.5 text-sm font-medium text-orange-400 transition-colors hover:bg-orange-950/70 disabled:opacity-50"
						>
							{testLoading ? 'Signing in…' : '⚙ Test login (dev only)'}
						</button>
					</form>
				</div>
			{/if}
		</div>
	</div>
</div>
