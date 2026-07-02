<script lang="ts">
	import HostAuthForm from '$lib/components/HostAuthForm.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mb-1 text-4xl font-black tracking-tight text-amber-400">MixUp!</div>
			<div class="text-xs uppercase tracking-widest text-zinc-400">Host Admin</div>
		</div>

		<div class="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
			<HostAuthForm {form} />
		</div>
	</div>
</div>
